import { Link, Section } from 'react-email'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { t, TransInterpolation } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
  const title = t('usernameRecovery.title', 'ShieldBattery Username Recovery')

  const email = '{{email}}'
  const displayNameText = t('usernameRecovery.displayName', '(display name: {{displayName}})', {
    displayName: '{{displayName}}',
  })

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'usernameRecovery.preview',
        'Someone requested a list of all login names registered to this email account on ' +
          'ShieldBattery.',
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='usernameRecovery.intro'>
              Someone requested a list of all login names registered to this email account (
              {{ email } as TransInterpolation}). If this wasn't you, you can safely ignore this
              email.
            </Trans>
          </EmailText>

          <EmailText>
            {t('usernameRecovery.listText', 'The login names registered to this email are:')}
          </EmailText>
          <ul
            dangerouslySetInnerHTML={{
              __html: `
                {{#each accounts}}
                  <li>
                    <span style="font-weight: 500">{{loginName}}</span>
                    {{#if displayName}}${displayNameText}{{/if}}
                  </li>
                {{/each}}
              `,
            }}
          />
          <EmailText>
            <Trans t={t} i18nKey='usernameRecovery.loginText'>
              You can log in with any of the above login names by visiting{' '}
              <Link href='{{{HOST}}}/login'>our login page</Link>.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
