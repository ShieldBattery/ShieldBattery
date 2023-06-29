import { Section } from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
  const title = t('emailChange.title', 'ShieldBattery Email Changed')

  const username = '{{username}}'

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'emailChange.preview',
        'You are receiving this email because the email address for {{username}} on ' +
          'ShieldBattery has been changed.',
        { username },
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='emailChange.intro'>
              You are receiving this email because the email address for{' '}
              <span style={{ fontWeight: 500 }}>{{ username } as TransInterpolation}</span> on
              ShieldBattery has been changed. If you did not request this change, please contact the
              ShieldBattery team.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
