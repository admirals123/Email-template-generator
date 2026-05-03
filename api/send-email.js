const nodemailer = require('nodemailer');

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to_email, to_name, subject, message, client_name, address, phone } = req.body;

  // Basic validation
  if (!to_email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields: to_email, subject, message' });
  }

  // Create transporter using Titan SMTP
  const transporter = nodemailer.createTransport({
    host: 'smtp.titan.email',
    port: 465,
    secure: true, // SSL
    auth: {
      user: process.env.SMTP_USER,   // info@3dvirtual.space
      pass: process.env.SMTP_PASS,   // your Titan password
    },
  });

  try {
    await transporter.sendMail({
      from: `"3D Virtuals" <${process.env.SMTP_USER}>`,
      to: to_email,
      bcc: process.env.SMTP_USER,    // BCC yourself on every send
      replyTo: process.env.SMTP_USER,
      subject: subject,
      html: message,
    });

    return res.status(200).json({ success: true, message: `Email sent to ${to_email}` });

  } catch (error) {
    console.error('SMTP error:', error);
    return res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
}
