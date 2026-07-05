import { useState } from 'react'
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
import {
  bodyLarge,
  labelMedium,
  singleLine,
  titleLarge,
  TitleMedium,
} from '../../styles/typography'
import { runTwitchOAuthFlow, TwitchOAuthResult } from '../../twitch/twitch-oauth'

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
  mutation ConnectionSettingsStartTwitchLink {
    twitchStartLink {
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

const SectionHeader = styled.div`
  ${titleLarge};
  margin-bottom: 8px;
`

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
    setBusy(true)
    connectTwitch()
      .catch(err => {
        logger.error(`Error linking Twitch account: ${getErrorStack(err)}`)
      })
      .finally(() => setBusy(false))
  }

  const connectTwitch = async () => {
    const startResult = await startTwitchLink({})
    if (startResult.error || !startResult.data) {
      showLinkError(startResult.error)
      return
    }

    let oauth: TwitchOAuthResult
    try {
      oauth = await runTwitchOAuthFlow(startResult.data.twitchStartLink.url)
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

  return (
    <Root>
      <Section>
        <SectionHeader>{t('settings.user.connections.title', 'Connections')}</SectionHeader>
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
          {connection ? (
            <TextButton
              label={t('settings.user.connections.twitch.disconnect', 'Disconnect')}
              disabled={busy}
              onClick={onDisconnect}
              testName='twitch-disconnect-button'
            />
          ) : (
            <FilledButton
              label={t('settings.user.connections.twitch.connect', 'Connect')}
              disabled={busy}
              onClick={onConnect}
              testName='twitch-connect-button'
            />
          )}
        </ServiceCard>
      </Section>
    </Root>
  )
}
