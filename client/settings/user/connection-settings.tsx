import { ResultOf } from '@graphql-typed-document-node/core'
import { ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CombinedError, useMutation, useQuery } from 'urql'
import { getErrorStack } from '../../../common/errors'
import { OauthProvider } from '../../../common/ipc'
import { graphql } from '../../gql'
import TwitchIcon from '../../icons/brands/twitch.svg?react'
import YoutubeIcon from '../../icons/brands/youtube.svg?react'
import logger from '../../logging/logger'
import { FilledButton, TextButton } from '../../material/button'
import { Card } from '../../material/card'
import { cancelOAuthFlow, OAuthResult, openOAuthPopup, runOAuthFlow } from '../../oauth/oauth-flow'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { bodyLarge, bodySmall, labelMedium, singleLine, TitleMedium } from '../../styles/typography'
import { TWITCH_PURPLE, YOUTUBE_RED } from '../../twitch/live-indicators'

// graphcache skips its "no cache key" warning for any type whose name ends in `Connection`,
// treating it as Relay pagination plumbing. `TwitchConnection` and `YoutubeConnection` are real
// entities that trip that exemption, so requesting `id` here is load-bearing: drop it and the
// object silently stops being normalized, with nothing in the console to say so.
const ConnectionSettingsQuery = graphql(/* GraphQL */ `
  query ConnectionSettings {
    myTwitchConnection {
      id
      twitchUserId
      twitchLogin
      twitchDisplayName
      linkedAt
    }
    myYoutubeConnection {
      id
      channelId
      title
      handle
      linkedAt
    }
  }
`)

type ConnectionSettingsData = ResultOf<typeof ConnectionSettingsQuery>

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
      id
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

const StartYoutubeLinkMutation = graphql(/* GraphQL */ `
  mutation ConnectionSettingsStartYoutubeLink($desktop: Boolean!) {
    youtubeStartLink(desktop: $desktop) {
      url
    }
  }
`)

const CompleteYoutubeLinkMutation = graphql(/* GraphQL */ `
  mutation ConnectionSettingsCompleteYoutubeLink($code: String!, $state: String!) {
    youtubeCompleteLink(code: $code, state: $state) {
      id
      channelId
      title
      handle
      linkedAt
    }
  }
`)

const UnlinkYoutubeMutation = graphql(/* GraphQL */ `
  mutation ConnectionSettingsUnlinkYoutube {
    youtubeUnlink
  }
`)

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 40px;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionDescription = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

const ServiceCard = styled(Card)`
  display: flex;
  align-items: center;
  gap: 16px;
`

const ServiceIcon = styled.div`
  width: 32px;
  height: 32px;
  flex-shrink: 0;

  svg {
    width: 100%;
    height: 100%;
  }
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

const ServiceHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/**
 * A card summarizing one external service connection: its icon, display name, current link
 * status, an optional hint about what linking it enables, and an action slot (connect/disconnect/
 * cancel, depending on the connection's current state).
 */
function ServiceConnectionCard({
  icon,
  name,
  status,
  hint,
  action,
}: {
  icon: ReactNode
  name: string
  status: string
  hint?: string
  action: ReactNode
}) {
  return (
    <ServiceCard>
      <ServiceIcon>{icon}</ServiceIcon>
      <ServiceInfo>
        <ServiceName>{name}</ServiceName>
        <ServiceStatus>{status}</ServiceStatus>
        {hint ? <ServiceHint>{hint}</ServiceHint> : undefined}
      </ServiceInfo>
      {action}
    </ServiceCard>
  )
}

/**
 * Drives one service's linking lifecycle on top of {@link ServiceConnectionCard}: running the
 * OAuth flow for `provider`, handing the resulting code to that service's complete-link mutation,
 * unlinking again, and keeping exactly one of those in flight at a time. Everything specific to a
 * service -- the GraphQL operations behind `startLink`/`completeLink`/`unlink`, and every string
 * shown -- is supplied by the caller, so a service is described rather than repeating this flow.
 */
function ServiceLinkCard({
  provider,
  icon,
  name,
  status,
  hint,
  isConnected,
  connectLabel,
  disconnectLabel,
  connectedSnackbar,
  disconnectedSnackbar,
  errorMessage,
  startLink,
  completeLink,
  unlink,
  onLinkChanged,
}: {
  provider: OauthProvider
  icon: ReactNode
  name: string
  status: string
  hint: string
  isConnected: boolean
  connectLabel: string
  disconnectLabel: string
  connectedSnackbar: string
  disconnectedSnackbar: string
  /** The message to show for a failed operation; called without an error for a generic failure. */
  errorMessage: (error?: CombinedError) => string
  /** Begins linking, resolving with the provider's authorize URL to send the user to. */
  startLink: (desktop: boolean) => Promise<{ url?: string; error?: CombinedError }>
  completeLink: (code: string, state: string) => Promise<{ error?: CombinedError }>
  unlink: () => Promise<{ error?: CombinedError }>
  /** Called once the link state changed on the server, so the connection query can be refreshed. */
  onLinkChanged: () => void
}) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [busy, setBusy] = useState(false)
  // `busy` only disables the button after a re-render, so a fast double-click can slip through
  // before that happens; this ref guards the gap synchronously.
  const busyRef = useRef(false)

  const onConnect = () => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    // Opened synchronously in the click handler, before any await: by the time the authorize URL
    // arrives from the mutation below, the click's transient user activation may have expired and
    // a `window.open` made then would be eaten by popup blockers. Not needed on desktop, where the
    // flow opens the user's system browser instead.
    const popup = IS_ELECTRON ? undefined : openOAuthPopup(provider)
    setBusy(true)
    connect(popup)
      .catch(err => {
        logger.error(`Error linking ${name} account: ${getErrorStack(err)}`)
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }

  const connect = async (popup: Window | null | undefined) => {
    // The desktop app runs the OAuth flow in the user's real browser via a loopback redirect, which
    // needs a different (fixed localhost) redirect URI than the web callback.
    let startResult
    try {
      startResult = await startLink(IS_ELECTRON)
    } catch (err) {
      popup?.close()
      throw err
    }
    if (!startResult.url) {
      popup?.close()
      snackbarController.showSnackbar(errorMessage(startResult.error))
      return
    }

    // From here, `runOAuthFlow` owns `popup`: navigating, waiting on it, and closing it.
    let oauth: OAuthResult
    try {
      oauth = await runOAuthFlow(provider, startResult.url, popup)
    } catch (err) {
      // The popup was blocked or the user closed it before finishing -- not worth a scary error.
      logger.warning(`${name} OAuth popup did not complete: ${getErrorStack(err)}`)
      return
    }

    if (oauth.error) {
      // `access_denied` just means the user declined at the provider; stay quiet in that case.
      if (oauth.error !== 'access_denied') {
        snackbarController.showSnackbar(oauth.errorDescription ?? errorMessage())
      }
      return
    }
    if (!oauth.code || !oauth.state) {
      return
    }

    const completeResult = await completeLink(oauth.code, oauth.state)
    if (completeResult.error) {
      snackbarController.showSnackbar(errorMessage(completeResult.error))
      return
    }

    onLinkChanged()
    snackbarController.showSnackbar(connectedSnackbar)
  }

  const onDisconnect = () => {
    setBusy(true)
    unlink()
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(errorMessage(result.error))
          return
        }
        onLinkChanged()
        snackbarController.showSnackbar(disconnectedSnackbar)
      })
      .catch(err => {
        logger.error(`Error unlinking ${name} account: ${getErrorStack(err)}`)
      })
      .finally(() => setBusy(false))
  }

  let connectionAction
  if (isConnected) {
    connectionAction = (
      <TextButton
        label={disconnectLabel}
        disabled={busy}
        onClick={onDisconnect}
        testName={`${provider}-disconnect-button`}
      />
    )
  } else if (busy && IS_ELECTRON) {
    // The desktop flow waits on the user's system browser for up to the OAuth flow's timeout; let
    // them bail out instead of being stuck busy that whole time. The web popup manages itself (it
    // settles when the user closes it), so it just keeps the disabled Connect button below.
    connectionAction = (
      <TextButton
        label={t('common.actions.cancel', 'Cancel')}
        onClick={() => cancelOAuthFlow()}
        testName={`${provider}-cancel-button`}
      />
    )
  } else {
    connectionAction = (
      <FilledButton
        label={connectLabel}
        disabled={busy}
        onClick={onConnect}
        testName={`${provider}-connect-button`}
      />
    )
  }

  return (
    <ServiceConnectionCard
      icon={icon}
      name={name}
      status={status}
      hint={hint}
      action={connectionAction}
    />
  )
}

const StyledTwitchIcon = styled(TwitchIcon)`
  width: 100%;
  height: 100%;
  color: ${TWITCH_PURPLE};
`

const StyledYoutubeIcon = styled(YoutubeIcon)`
  width: 100%;
  height: 100%;
  color: ${YOUTUBE_RED};
`

function TwitchConnectionCard({
  connection,
  onLinkChanged,
}: {
  connection: ConnectionSettingsData['myTwitchConnection'] | undefined
  onLinkChanged: () => void
}) {
  const { t } = useTranslation()
  const [, startTwitchLink] = useMutation(StartTwitchLinkMutation)
  const [, completeTwitchLink] = useMutation(CompleteTwitchLinkMutation)
  const [, unlinkTwitch] = useMutation(UnlinkTwitchMutation)

  const errorMessage = (error?: CombinedError) => {
    switch (error?.graphQLErrors?.[0]?.extensions?.code) {
      case 'TWITCH_ALREADY_LINKED':
        return t(
          'settings.user.connections.twitch.errors.alreadyLinked',
          'That Twitch account is already linked to another ShieldBattery account.',
        )
      case 'TWITCH_INVALID_STATE':
        return t(
          'settings.user.connections.twitch.errors.invalidState',
          'Your Twitch linking request expired. Please try again.',
        )
      case 'TWITCH_NOT_CONFIGURED':
        return t(
          'settings.user.connections.twitch.errors.notConfigured',
          'Twitch linking is not available right now.',
        )
      default:
        return t(
          'settings.user.connections.twitch.errors.generic',
          'Something went wrong linking your Twitch account. Please try again.',
        )
    }
  }

  return (
    <ServiceLinkCard
      provider='twitch'
      icon={<StyledTwitchIcon />}
      name={t('settings.user.connections.twitch.name', 'Twitch')}
      status={
        connection
          ? t('settings.user.connections.twitch.connectedAs', 'Connected as {{channel}}', {
              channel: connection.twitchDisplayName,
            })
          : t('settings.user.connections.twitch.notConnected', 'Not connected')
      }
      hint={t(
        'settings.user.connections.twitch.feedHint',
        'Streams in the StarCraft categories appear in the live streams feed.',
      )}
      isConnected={!!connection}
      connectLabel={t('settings.user.connections.twitch.connect', 'Connect')}
      disconnectLabel={t('settings.user.connections.twitch.disconnect', 'Disconnect')}
      connectedSnackbar={t(
        'settings.user.connections.twitch.connectedSnackbar',
        'Twitch account connected.',
      )}
      disconnectedSnackbar={t(
        'settings.user.connections.twitch.disconnectedSnackbar',
        'Twitch account disconnected.',
      )}
      errorMessage={errorMessage}
      startLink={async desktop => {
        const result = await startTwitchLink({ desktop })
        return { url: result.data?.twitchStartLink.url, error: result.error }
      }}
      completeLink={(code, state) => completeTwitchLink({ code, state })}
      unlink={() => unlinkTwitch({})}
      onLinkChanged={onLinkChanged}
    />
  )
}

function YoutubeConnectionCard({
  connection,
  onLinkChanged,
}: {
  connection: ConnectionSettingsData['myYoutubeConnection'] | undefined
  onLinkChanged: () => void
}) {
  const { t } = useTranslation()
  const [, startYoutubeLink] = useMutation(StartYoutubeLinkMutation)
  const [, completeYoutubeLink] = useMutation(CompleteYoutubeLinkMutation)
  const [, unlinkYoutube] = useMutation(UnlinkYoutubeMutation)

  const errorMessage = (error?: CombinedError) => {
    switch (error?.graphQLErrors?.[0]?.extensions?.code) {
      case 'YOUTUBE_ALREADY_LINKED':
        return t(
          'settings.user.connections.youtube.errors.alreadyLinked',
          'That YouTube channel is already linked to another ShieldBattery account.',
        )
      case 'YOUTUBE_INVALID_STATE':
        return t(
          'settings.user.connections.youtube.errors.invalidState',
          'Your YouTube linking request expired. Please try again.',
        )
      case 'YOUTUBE_NOT_CONFIGURED':
        return t(
          'settings.user.connections.youtube.errors.notConfigured',
          'YouTube linking is not available right now.',
        )
      case 'YOUTUBE_NO_CHANNEL':
        return t(
          'settings.user.connections.youtube.errors.noChannel',
          "That Google account doesn't have a YouTube channel.",
        )
      default:
        return t(
          'settings.user.connections.youtube.errors.generic',
          'Something went wrong linking your YouTube channel. Please try again.',
        )
    }
  }

  return (
    <ServiceLinkCard
      provider='youtube'
      icon={<StyledYoutubeIcon />}
      name={t('settings.user.connections.youtube.name', 'YouTube')}
      status={
        connection
          ? t('settings.user.connections.youtube.connectedAs', 'Connected as {{channel}}', {
              channel: connection.title,
            })
          : t('settings.user.connections.youtube.notConnected', 'Not connected')
      }
      hint={t(
        'settings.user.connections.youtube.feedHint',
        'Broadcasts that mention StarCraft or Brood War in their title or description appear in the live streams feed.',
      )}
      isConnected={!!connection}
      connectLabel={t('settings.user.connections.youtube.connect', 'Connect')}
      disconnectLabel={t('settings.user.connections.youtube.disconnect', 'Disconnect')}
      connectedSnackbar={t(
        'settings.user.connections.youtube.connectedSnackbar',
        'YouTube channel connected.',
      )}
      disconnectedSnackbar={t(
        'settings.user.connections.youtube.disconnectedSnackbar',
        'YouTube channel disconnected.',
      )}
      errorMessage={errorMessage}
      startLink={async desktop => {
        const result = await startYoutubeLink({ desktop })
        return { url: result.data?.youtubeStartLink.url, error: result.error }
      }}
      completeLink={(code, state) => completeYoutubeLink({ code, state })}
      unlink={() => unlinkYoutube({})}
      onLinkChanged={onLinkChanged}
    />
  )
}

export function ConnectionSettings() {
  const { t } = useTranslation()
  // One query for every service: each card reads its own slice, and any card that changes a link
  // refreshes all of them, so the page can never show a stale status for the other service.
  const [{ data }, refetchConnections] = useQuery({ query: ConnectionSettingsQuery })
  const onLinkChanged = () => refetchConnections({ requestPolicy: 'network-only' })

  return (
    <Root>
      <Section>
        <SectionDescription>
          {t(
            'settings.user.connections.description',
            'Link external accounts to your ShieldBattery profile.',
          )}
        </SectionDescription>

        <TwitchConnectionCard connection={data?.myTwitchConnection} onLinkChanged={onLinkChanged} />
        <YoutubeConnectionCard
          connection={data?.myYoutubeConnection}
          onLinkChanged={onLinkChanged}
        />
      </Section>
    </Root>
  )
}
