const nodemailer = require('nodemailer');
const Imap = require('imap');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to_email, subject, message } = req.body;

  if (!to_email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;

  // ── 1. Send via Titan SMTP ──
  const transporter = nodemailer.createTransport({
    host: 'smtp.titan.email',
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const sentDate = new Date();

  const mailOptions = {
    from:    `"3D Virtuals" <${SMTP_USER}>`,
    to:      to_email,
    replyTo: SMTP_USER,
    subject: subject,
    html:    message,
    date:    sentDate,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error('SMTP send error:', err);
    return res.status(500).json({ error: 'Failed to send email', details: err.message });
  }

  // ── 2. Append to Sent folder via IMAP ──
  const raw = buildRaw(mailOptions);

  try {
    await appendToSent(raw, SMTP_USER, SMTP_PASS);
  } catch (err) {
    // Log but don't fail — email was already sent
    console.error('IMAP append error (non-fatal):', err.message);
  }

  return res.status(200).json({ success: true });
};

// ── Build minimal RFC2822 message ──
function buildRaw(opts) {
  const boundary = `_boundary_${Date.now()}`;
  const plain = opts.html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Reply-To: ${opts.replyTo}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.date.toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    plain,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    opts.html,
    ``,
    `--${boundary}--`,
  ].join('\r\n');
}

// ── Connect to Titan IMAP, find Sent folder, append ──
function appendToSent(raw, user, pass) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user,
      password: pass,
      host:     'imap.titan.email',
      port:     993,
      tls:      true,
      tlsOptions:  { rejectUnauthorized: false },
      connTimeout: 8000,
      authTimeout: 8000,
    });

    let resolved = false;
    function done(err) {
      if (resolved) return;
      resolved = true;
      try { imap.end(); } catch (_) {}
      if (err) reject(err); else resolve();
    }

    imap.once('error', done);

    imap.once('ready', () => {
      // List all boxes to find the real Sent folder name
      imap.getBoxes((err, boxes) => {
        if (err) return done(err);

        // Find folder whose special-use or name indicates Sent
        const sentFolder = findSentFolder(boxes);
        if (!sentFolder) return done(new Error('Sent folder not found'));

        imap.append(
          Buffer.from(raw),
          { mailbox: sentFolder, flags: ['\\Seen'] },
          (appendErr) => done(appendErr || null)
        );
      });
    });

    imap.connect();
  });
}

// ── Recursively search boxes for the Sent folder ──
function findSentFolder(boxes, prefix) {
  prefix = prefix || '';
  const sentKeywords = ['sent', 'sent items', 'sent messages', 'sent mail'];

  for (const [name, box] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name;
    const lower = name.toLowerCase();

    // Match by special-use attribute
    if (box.attribs && box.attribs.includes('\\Sent')) return fullName;

    // Match by name
    if (sentKeywords.includes(lower)) return fullName;

    // Recurse into children
    if (box.children) {
      const child = findSentFolder(box.children, fullName);
      if (child) return child;
    }
  }
  return null;
}
