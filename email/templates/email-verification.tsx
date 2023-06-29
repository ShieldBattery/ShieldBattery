import { Section } from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { t } from '../i18n/i18next'
import {
  EmailButton,
  EmailContainer,
  EmailHeading,
  EmailSignature,
  EmailText,
  SbEmail,
} from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
  const title = t('emailVerification.title', 'ShieldBattery Email Verification')

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'emailVerification.preview',
        'Thank you for signing up to ShieldBattery! Please confirm your email address by ' +
          'clicking the link below.',
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
              Please confirm your email address by clicking the link below. We may need to send you
              critical information about our service and it is important that we have an accurate
              email address.
            </Trans>
          </EmailText>

          <div style={{ textAlign: 'center' }}>
            <EmailButton
              href={
                '{{{HOST}}}/verify-email?token={{token}}&userId={{userId}}&username={{username}}'
              }>
              {t('emailVerification.button', 'Verify email')}
            </EmailButton>
          </div>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
