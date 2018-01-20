import sendMail from '../mail/mailer'

export default async function sendAccountVerificationEmail(userId, email, token) {
  await sendMail({
    to: email,
    subject: 'ShieldBattery Email Verification',
    templateName: 'email-verification',
    templateData: {
      userId,
      escapedEmail: encodeURIComponent(email),
      token,
    },
  })
}
