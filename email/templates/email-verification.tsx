import { Container, Section } from '@react-email/components'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { t } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
  const title = t('emailVerification.title', 'ShieldBattery Email Verification')

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'emailVerification.preview',
        'Thank you for signing up to ShieldBattery! Please confirm your email address by ' +
          'entering the code in the account settings.',
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='emailVerification.intro'>
              Thank you for signing up to ShieldBattery!
            </Trans>
          </EmailText>

          <EmailText>
            <Trans t={t} i18nKey='emailVerification.body'>
              Please confirm your email address by entering the following code in the account
              settings inside ShieldBattery. We may need to send you critical information about our
              service and it is important that we have an accurate email address.
            </Trans>
          </EmailText>

          <Container
            style={{
              padding: '0 8px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #e0e0e0',
              borderRadius: '4px',
            }}>
            <EmailText style={{ fontSize: '20px' }}>{'{{code}}'}</EmailText>
          </Container>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
