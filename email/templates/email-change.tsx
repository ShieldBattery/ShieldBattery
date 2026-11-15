import { Section } from 'react-email'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { t, TransInterpolation } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

/** The subject line of this email, in the current language. */
export function subject() {
  return t('emailChange.title', 'ShieldBattery Email Changed')
}

export default function EmailChange(props: EmailProps) {
  const title = subject()

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
