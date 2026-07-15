import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { getErrorStack } from '../../../common/errors'
import { graphql } from '../../gql'
import TwitchIcon from '../../icons/brands/twitch.svg'
import logger from '../../logging/logger'
import { FilledButton, TextButton } from '../../material/button'
import { Card } from '../../material/card'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { bodyLarge, labelMedium, singleLine, TitleMedium } from '../../styles/typography'
import {
  cancelTwitchOAuthFlow,
  openTwitchOAuthPopup,
  runTwitchOAuthFlow,
  TwitchOAuthResult,
} from '../../twitch/twitch-oauth'

const ConnectionSettingsQuery = graphql(/* GraphQL */ `
  query ConnectionSettings {
    myTwitchConnection {
      twitchUserId
      twitchLogin
      twitchDisplayName
      linkedAt
    }
  }
`)

const StartTwitchLinkMutation = graphql(/* GraphQL */ `
  mutation ConnectionSettingsStartTwitchLink($desktop: Boolean!) {
    twitchStartLink(desktop: $desktop) {
      url
    }
  }
`)

const CompleteTwitchLinkMutation = graphql(/* GraphQL */ `
  mutation ConnectionSettingsCompleteTwitchLink($code: String!, $state: String!) {
    twitchCompleteLink(code: $code, state: $state) {
      twitchUserId
      twitchLogin
      twitchDisplayName
      linkedAt
    }
  }
`)

const UnlinkTwitchMutation = graphql(/* GraphQL */ `
  mutation ConnectionSettingsUnlinkTwitch {
    twitchUnlink
  }
`)

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 40px;
`

const Section = styled.div``

const SectionDescription = styled.div`
  ${bodyLarge};
  margin-bottom: 16px;
  color: var(--theme-on-surface-variant);
`

const ServiceCard = styled(Card)`
  display: flex;
  align-items: center;
  gap: 16px;
`

const StyledTwitchIcon = styled(TwitchIcon)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  color: #9146ff;
`

const ServiceInfo = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const ServiceName = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const ServiceStatus = styled(TitleMedium)`
  ${singleLine};
`

export function ConnectionSettings() {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ data }, refetchConnection] = useQuery({ query: ConnectionSettingsQuery })
  const [, startTwitchLink] = useMutation(StartTwitchLinkMutation)
  const [, completeTwitchLink] = useMutation(CompleteTwitchLinkMutation)
  const [, unlinkTwitch] = useMutation(UnlinkTwitchMutation)
  const [busy, setBusy] = useState(false)
  // `busy` only disables the button after a re-render, so a fast double-click can slip through
  // before that happens; this ref guards the gap synchronously.
  const busyRef = useRef(false)

  const connection = data?.myTwitchConnection

  const showLinkError = (error: CombinedError | undefined) => {
    const code = error?.graphQLErrors?.[0]?.extensions?.code
    switch (code) {
      case 'TWITCH_ALREADY_LINKED':
        snackbarController.showSnackbar(
          t(
            'settings.user.connections.twitch.errors.alreadyLinked',
            'That Twitch account is already linked to another ShieldBattery account.',
          ),
        )
        break
      case 'TWITCH_INVALID_STATE':
        snackbarController.showSnackbar(
          t(
            'settings.user.connections.twitch.errors.invalidState',
            'Your Twitch linking request expired. Please try again.',
          ),
        )
        break
      case 'TWITCH_NOT_CONFIGURED':
        snackbarController.showSnackbar(
          t(
            'settings.user.connections.twitch.errors.notConfigured',
            'Twitch linking is not available right now.',
          ),
        )
        break
      default:
        snackbarController.showSnackbar(
          t(
            'settings.user.connections.twitch.errors.generic',
            'Something went wrong linking your Twitch account. Please try again.',
          ),
        )
        break
    }
  }

  const onConnect = () => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    // Opened synchronously in the click handler, before any await: by the time the authorize URL
    // arrives from the mutation below, the click's transient user activation may have expired and
    // a `window.open` made then would be eaten by popup blockers. Not needed on desktop, where the
    // flow opens the user's system browser instead.
    const popup = IS_ELECTRON ? undefined : openTwitchOAuthPopup()
    setBusy(true)
    connectTwitch(popup)
      .catch(err => {
        logger.error(`Error linking Twitch account: ${getErrorStack(err)}`)
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }

  const connectTwitch = async (popup: Window | null | undefined) => {
    // The desktop app runs the OAuth flow in the user's real browser via a loopback redirect, which
    // needs a different (fixed localhost) redirect URI than the web callback.
    let startResult
    try {
      startResult = await startTwitchLink({ desktop: IS_ELECTRON })
    } catch (err) {
      popup?.close()
      throw err
    }
    if (startResult.error || !startResult.data) {
      popup?.close()
      showLinkError(startResult.error)
      return
    }

    // From here, `runTwitchOAuthFlow` owns `popup`: navigating, waiting on it, and closing it.
    let oauth: TwitchOAuthResult
    try {
      oauth = await runTwitchOAuthFlow(startResult.data.twitchStartLink.url, popup)
    } catch (err) {
      // The popup was blocked or the user closed it before finishing -- not worth a scary error.
      logger.warning(`Twitch OAuth popup did not complete: ${getErrorStack(err)}`)
      return
    }

    if (oauth.error) {
      // `access_denied` just means the user declined on Twitch; stay quiet in that case.
      if (oauth.error !== 'access_denied') {
        snackbarController.showSnackbar(
          oauth.errorDescription ??
            t(
              'settings.user.connections.twitch.errors.generic',
              'Something went wrong linking your Twitch account. Please try again.',
            ),
        )
      }
      return
    }
    if (!oauth.code || !oauth.state) {
      return
    }

    const completeResult = await completeTwitchLink({ code: oauth.code, state: oauth.state })
    if (completeResult.error) {
      showLinkError(completeResult.error)
      return
    }

    refetchConnection({ requestPolicy: 'network-only' })
    snackbarController.showSnackbar(
      t('settings.user.connections.twitch.connectedSnackbar', 'Twitch account connected.'),
    )
  }

  const onDisconnect = () => {
    setBusy(true)
    unlinkTwitch({})
      .then(result => {
        if (result.error) {
          showLinkError(result.error)
          return
        }
        refetchConnection({ requestPolicy: 'network-only' })
        snackbarController.showSnackbar(
          t(
            'settings.user.connections.twitch.disconnectedSnackbar',
            'Twitch account disconnected.',
          ),
        )
      })
      .catch(err => {
        logger.error(`Error unlinking Twitch account: ${getErrorStack(err)}`)
      })
      .finally(() => setBusy(false))
  }

  let connectionAction
  if (connection) {
    connectionAction = (
      <TextButton
        label={t('settings.user.connections.twitch.disconnect', 'Disconnect')}
        disabled={busy}
        onClick={onDisconnect}
        testName='twitch-disconnect-button'
      />
    )
  } else if (busy && IS_ELECTRON) {
    // The desktop flow waits on the user's system browser for up to `TWITCH_OAUTH_TIMEOUT_MS`;
    // let them bail out instead of being stuck busy that whole time. The web popup manages itself
    // (it settles when the user closes it), so it just keeps the disabled Connect button below.
    connectionAction = (
      <TextButton
        label={t('common.actions.cancel', 'Cancel')}
        onClick={() => cancelTwitchOAuthFlow()}
        testName='twitch-cancel-button'
      />
    )
  } else {
    connectionAction = (
      <FilledButton
        label={t('settings.user.connections.twitch.connect', 'Connect')}
        disabled={busy}
        onClick={onConnect}
        testName='twitch-connect-button'
      />
    )
  }

  return (
    <Root>
      <Section>
        <SectionDescription>
          {t(
            'settings.user.connections.description',
            'Link external accounts to your ShieldBattery profile.',
          )}
        </SectionDescription>

        <ServiceCard>
          <StyledTwitchIcon />
          <ServiceInfo>
            <ServiceName>{t('settings.user.connections.twitch.name', 'Twitch')}</ServiceName>
            <ServiceStatus>
              {connection
                ? t('settings.user.connections.twitch.connectedAs', 'Connected as {{channel}}', {
                    channel: connection.twitchDisplayName,
                  })
                : t('settings.user.connections.twitch.notConnected', 'Not connected')}
            </ServiceStatus>
          </ServiceInfo>
          {connectionAction}
        </ServiceCard>
      </Section>
    </Root>
  )
}
