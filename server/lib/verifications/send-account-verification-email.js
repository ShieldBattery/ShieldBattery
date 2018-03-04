import sendMail from '../mail/mailer'

export default async function sendAccountVerificationEmail(email, token) {
  await sendMail({
    to: email,
    subject: 'ShieldBattery Email Verification',
    templateName: 'email-verification',
    templateData: { token },
  })
}
