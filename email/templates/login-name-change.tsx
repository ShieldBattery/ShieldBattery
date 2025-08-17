import { Section } from '@react-email/components'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function LoginNameChange(props: EmailProps) {
  const title = t('loginNameChange.title', 'ShieldBattery Login Name Changed')

  const username = '{{username}}'
  const oldLoginName = '{{oldLoginName}}'
  const newLoginName = '{{newLoginName}}'

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'loginNameChange.preview',
        'You are receiving this email because the login name for {{username}} on ShieldBattery has been changed.',
        { username },
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='loginNameChange.intro'>
              You are receiving this email because the login name for{' '}
              <span style={{ fontWeight: 500 }}>{{ username } as TransInterpolation}</span> on
              ShieldBattery has been changed.
            </Trans>
          </EmailText>

          <EmailText>
            <Trans t={t} i18nKey='loginNameChange.details'>
              Your login name has been changed from{' '}
              <span style={{ fontWeight: 500 }}>{{ oldLoginName } as TransInterpolation}</span> to{' '}
              <span style={{ fontWeight: 500 }}>{{ newLoginName } as TransInterpolation}</span>.
            </Trans>
          </EmailText>

          <EmailText>
            <Trans t={t} i18nKey='loginNameChange.security'>
              If you did not request this change, please contact support immediately.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
