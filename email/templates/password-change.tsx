import { Section } from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
  const title = t('passwordChange.title', 'ShieldBattery Password Changed')

  const username = '{{username}}'

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'passwordChange.preview',
        'You are receiving this email because the password for {{username}} on ShieldBattery has ' +
          'been changed.',
        { username },
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='passwordChange.intro'>
              You are receiving this email because the password for{' '}
              <span style={{ fontWeight: 500 }}>{{ username } as TransInterpolation}</span> on
              ShieldBattery has been changed.
            </Trans>
          </EmailText>

          <EmailText>
            <Trans t={t} i18nKey='passwordChange.body'>
              If you did not request this change, you can reset your password by visiting{' '}
              <a href='{{{HOST}}}/forgot-password'>this link</a>.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
