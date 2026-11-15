import { Link, Section } from 'react-email'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { t, TransInterpolation } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

const ACCOUNT_CELL_CSS = 'padding: 4px 24px 4px 0; text-align: left;'

const headerCellStyle = {
  padding: '4px 24px 4px 0',
  textAlign: 'left',
  fontWeight: 400,
  color: '#616161',
  borderBottom: '1px solid #e0e0e0',
} as const

/** The subject line of this email, in the current language. */
export function subject() {
  return t('usernameRecovery.title', 'ShieldBattery Username Recovery')
}

export default function UsernameRecovery(props: EmailProps) {
  const title = subject()

  const email = '{{email}}'

  return (
    <SbEmail
      {...props}
      title={title}
      preview={t(
        'usernameRecovery.preview',
        'Someone requested a list of all usernames registered to this email account on ' +
          'ShieldBattery.',
      )}>
      <EmailContainer>
        <EmailHeading>{title}</EmailHeading>

        <Section>
          <EmailText>
            <Trans t={t} i18nKey='usernameRecovery.intro'>
              Someone requested a list of all usernames registered to this email account (
              {{ email } as TransInterpolation}). If this wasn't you, you can safely ignore this
              email.
            </Trans>
          </EmailText>

          <EmailText>
            {t('usernameRecovery.accountsText', 'The accounts registered to this email are:')}
          </EmailText>
          <table
            cellPadding={0}
            cellSpacing={0}
            style={{ fontSize: '14px', lineHeight: '20px', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={headerCellStyle}>
                  {t('usernameRecovery.loginNameHeader', 'Login name')}
                </th>
                <th style={headerCellStyle}>
                  {t('usernameRecovery.displayNameHeader', 'Display name')}
                </th>
              </tr>
            </thead>
            <tbody
              dangerouslySetInnerHTML={{
                __html: `
                  {{#each accounts}}
                    <tr>
                      <td style="${ACCOUNT_CELL_CSS} font-weight: 500;">{{loginName}}</td>
                      <td style="${ACCOUNT_CELL_CSS}">{{displayName}}</td>
                    </tr>
                  {{/each}}
                `,
              }}
            />
          </table>
          <EmailText>
            <Trans t={t} i18nKey='usernameRecovery.logInText'>
              Use a login name, not a display name, to log in. You can do that with any of the login
              names above by visiting <Link href='{{{HOST}}}/login'>our login page</Link>.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
