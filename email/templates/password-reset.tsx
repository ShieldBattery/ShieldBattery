import { Section } from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'
import {
  EmailButton,
  EmailContainer,
  EmailHeading,
  EmailSignature,
  EmailText,
  SbEmail,
} from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
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

          <EmailText>
            <Trans t={t} i18nKey='passwordReset.body'>
              Click the link below to set a new password for your account.
            </Trans>
          </EmailText>

          <div style={{ textAlign: 'center' }}>
            <EmailButton href={'{{{HOST}}}/verify-email?token={{token}}&username={{username}}'}>
              {t('passwordReset.button', 'Reset password')}
            </EmailButton>
          </div>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
