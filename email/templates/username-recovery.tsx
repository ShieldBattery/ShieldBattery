import {
  Body,
  Container,
  Font,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import React from 'react'
import { TransWithoutContext as Trans } from 'react-i18next'
import { EmailProps } from '../email-props'
import { TransInterpolation, t } from '../i18n/i18next'

export interface SbEmailProps extends EmailProps {
  children: React.ReactNode
  title: string
  preview: string
}

/**
 * The root component for all ShieldBattery emails.
 */
export function SbEmail(props: SbEmailProps) {
  return (
    <Html lang={props.lang} dir={props.dir}>
      <Head>
        <title>{props.title}</title>
        <Font
          fontFamily='Inter'
          fallbackFontFamily='Arial'
          fontWeight={400}
          fontStyle='normal'
          webFont={{
            url: 'https://fonts.gstatic.com/s/inter/v12/UcCo3FwrK3iLTcviYwY.woff2',
            format: 'woff2',
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              * {
                font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
              }
            `,
          }}
        />
      </Head>
      <Preview>{props.preview}</Preview>
      <Body
        style={{
          padding: '16px',
          fontFamily: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: '16px',
          lineHeight: 1.5,
          backgroundColor: '#fafafa',
          color: '#212121',
        }}>
        {props.children}

        <Section style={{}}>
          <Row>
            <Text style={{ margin: '0', textAlign: 'center', fontSize: '12px', color: '#9e9e9e' }}>
              <Trans t={t} i18nKey={'common.footer'}>
                Follow <Link href='http://twitter.com/ShieldBatteryBW'>@ShieldBatteryBW</Link> on
                Twitter.
              </Trans>
            </Text>
          </Row>
        </Section>
      </Body>
    </Html>
  )
}

/**
 * The main content container for ShieldBattery emails, should be used in most cases to ensure
 * consistent styling/alignment.
 */
export function EmailContainer(props: Parameters<typeof Container>[0]) {
  return (
    <Container
      {...props}
      style={{
        width: '580px',
        margin: '8px auto',
        backgroundColor: '#ffffff',
        border: '1px solid #e0e0e0',
        borderRadius: '2px',
        padding: '0 16px 16px',
        ...props.style,
      }}
    />
  )
}

/** Title heading for ShieldBattery emails. */
export function EmailHeading(props: Parameters<typeof Heading>[0]) {
  return (
    <Heading
      {...props}
      style={{
        fontSize: '24px',
        textRendering: 'optimizeLegibility',
        color: '#424242',
        margin: '16px 0 0',
        ...props.style,
      }}
    />
  )
}

export function EmailText(props: Parameters<typeof Text>[0]) {
  return (
    <Text
      {...props}
      style={{
        fontSize: '14px',
        lineHeight: '20px',
        ...props.style,
      }}
    />
  )
}

export function EmailSignature() {
  return (
    <Section>
      <EmailText style={{ marginBottom: '8px' }}>
        {t('common.signatureText', 'gl hf gogogo')}
      </EmailText>
      <EmailText style={{ marginTop: '8px' }}>
        {t('common.signatureFrom', '— The ShieldBattery team')}
      </EmailText>
    </Section>
  )
}

/**
 * Outputs the raw source of a Handlebars template to the document. Don't use with things that
 * aren't handlebars templates!!!
 *
 * This is generally only necessary if the template contains HTML elements.
 */
export function HandlebarsTemplate(props: { src: string }) {
  return <div dangerouslySetInnerHTML={{ __html: props.src }} />
}

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
