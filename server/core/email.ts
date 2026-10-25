/**
 * Email delivery for the password-reset flow. SMTP is optional: when the SMTP
 * environment is not configured the reset link is logged instead, so the feature
 * stays testable in local dev without a mail server.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[email] SMTP not configured — password reset for ${to}: ${resetUrl}`);
    return false;
  }

  const { createTransport } = await import('nodemailer');
  const transporter = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'no-reply@signaldesk.app',
    to,
    subject: 'Reset your SignalDesk password',
    text: [
      'We received a request to reset your SignalDesk password.',
      '',
      `Reset it here: ${resetUrl}`,
      '',
      "This link expires in 1 hour. If you didn't request this, you can safely ignore this email.",
    ].join('\n'),
  });

  return true;
}
