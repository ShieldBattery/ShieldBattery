import { Link, Section } from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'
import { EmailContainer, EmailHeading, EmailSignature, EmailText, SbEmail } from '../ui/email-ui'

export default function UsernameRecovery(props: EmailProps) {
  const title = t('usernameRecovery.title', 'ShieldBattery Username Recovery')

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
            {t('usernameRecovery.listText', 'The usernames registered to this email are:')}
          </EmailText>
          <ul
            dangerouslySetInnerHTML={{
              __html: `
                {{#each usernames}}
                  <li>{{username}}</li>
                {{/each}}
              `,
            }}
          />
          <EmailText>
            <Trans t={t} i18nKey='usernameRecovery.loginText'>
              You can log in with any of the above usernames by visiting{' '}
              <Link href='{{{HOST}}}/login'>our login page</Link>.
            </Trans>
          </EmailText>
        </Section>
        <EmailSignature />
      </EmailContainer>
    </SbEmail>
  )
}
