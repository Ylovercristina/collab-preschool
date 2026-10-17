const nodemailer = require('nodemailer');

let transporter;

function smtpSettings() {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    from: process.env.SMTP_FROM || (user ? `Play-is-School <${user}>` : ''),
  };
}

function getTransporter() {
  const settings = smtpSettings();
  const missing = ['SMTP_USER/EMAIL_USER', 'SMTP_PASS/EMAIL_PASS', 'SMTP_FROM']
    .filter((name) => name === 'SMTP_USER/EMAIL_USER' ? !settings.user
      : name === 'SMTP_PASS/EMAIL_PASS' ? !settings.pass : !settings.from);
  if (missing.length) throw new Error(`SMTP configuration is incomplete: ${missing.join(', ')}`);

  if (!transporter) {
    if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error('SMTP_PORT must be a valid port number.');
    transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      auth: { user: settings.user, pass: settings.pass },
    });
  }
  return transporter;
}

function emailTransportError(error) {
  const redact = (value) => {
    let text = String(value || '');
    const secret = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    if (secret) text = text.split(secret).join('[redacted]');
    return text;
  };
  return { message: redact(error.message || 'Email delivery failed.'), code: error.code, response: redact(error.response) };
}

async function sendEmail({ to, subject, html, text }) {
  try {
    const info = await getTransporter().sendMail({
      from: smtpSettings().from,
      to,
      subject,
      html,
      text,
    });
    if (Array.isArray(info.accepted) && !info.accepted.some((recipient) => String(recipient).toLowerCase() === String(to).toLowerCase())) {
      return { success: false, error: info.rejected?.length ? `SMTP rejected recipient: ${info.rejected.join(', ')}` : 'SMTP did not accept this recipient.' };
    }
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: emailTransportError(error).message };
  }
}

async function verifyEmailTransport() {
  return getTransporter().verify();
}

module.exports = { sendEmail, verifyEmailTransport, emailTransportError };