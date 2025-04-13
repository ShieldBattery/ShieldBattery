import { Container, Section } from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function PasswordReset(props: EmailProps) {
  const title = t('passwordReset.title', 'ShieldBattery Password Reset')

  const username = '{{username}}'

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'passwordReset.preview',
        'You are receiving this email because someone requested a password reset for ' +
          '{{username}} on ShieldBattery.',
        { username },
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='passwordReset.intro'>
              You are receiving this email because someone requested a password reset for{' '}
              <span style={{ fontWeight: 500 }}>{{ username } as TransInterpolation}</span> on
              ShieldBattery. If you didn't make this request, please ignore this email.
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

          <EmailText>
            <Trans t={t} i18nKey='passwordReset.body'>
              To choose a new password, enter the code above in the app or on the website along with
              your new password.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
