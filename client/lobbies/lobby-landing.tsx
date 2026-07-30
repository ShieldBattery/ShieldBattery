import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { gameTypeToLabel } from '../../common/games/game-type'
import { LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../common/urls'
import { MaterialIcon } from '../icons/material/material-icon'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FilledButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { CenteredContentContainer } from '../styles/centered-container'
import { BodyLarge, BodyMedium, HeadlineMedium, bodyLarge, labelMedium } from '../styles/typography'
import { useCorrectLobbySlug } from './lobby-url'

const Root = styled(CenteredContentContainer)`
  padding-block: 48px 24px;
`

const StateMessageLayout = styled.div`
  width: 100%;
  padding: 48px 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;

  text-align: center;
`

const StateMessageIcon = styled(MaterialIcon).attrs({ size: 96, filled: false })`
  color: var(--theme-on-surface-variant);
`

const LobbyName = styled(HeadlineMedium)`
  margin-bottom: 24px;
  text-align: center;
  overflow-wrap: break-word;
`

const InfoLayout = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 24px;
`

const MAP_THUMBNAIL_SIZE = 208

const MapThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${MAP_THUMBNAIL_SIZE}px;
`

const DetailsList = styled.div`
  flex-grow: 1;
  margin-top: 8px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const DetailRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;
`

const DetailLabel = styled.div`
  ${labelMedium};
  width: 88px;
  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  text-align: right;
`

const DetailValue = styled.div`
  ${bodyLarge};
`

const CtaLayout = styled.div`
  margin-top: 40px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`

const AppHint = styled(BodyMedium)`
  max-width: 480px;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

type LoadState =
  { status: 'loaded'; data: LobbySummaryResponse } | { status: 'notFound' } | { status: 'error' }

export interface LobbyLandingPageProps {
  params: { lobbyId: string }
}

/**
 * A logged-out web landing page for a lobby link (`/lobbies/<id>/<name-slug>`). Electron renders
 * the real lobby (`LobbyView`) at this route instead -- this page exists purely so that sharing a
 * lobby link outside the app (e.g. in a browser) shows something useful rather than a blank route.
 * Lobbies are ephemeral, so a dead link (404 from the summary endpoint) is an expected, first-class
 * outcome here, not an error case.
 */
export function LobbyLandingPage({ params }: LobbyLandingPageProps) {
  const lobbyId = makeSbLobbyId(params.lobbyId)

  // Tagged with the lobby id it was resolved for, so a stale result from a previous id (e.g. if
  // this route's params change without the component unmounting) doesn't get rendered as current --
  // the state is treated as still-loading until a result tagged with the current id arrives.
  const [result, setResult] = useState<{ lobbyId: string; state: LoadState }>()

  useEffect(() => {
    const controller = new AbortController()

    fetchJson<LobbySummaryResponse>(apiUrl`lobbies/${lobbyId}/summary`, {
      signal: controller.signal,
    }).then(
      data => {
        setResult({ lobbyId, state: { status: 'loaded', data } })
      },
      err => {
        if (controller.signal.aborted) {
          return
        }
        setResult({
          lobbyId,
          state:
            isFetchError(err) && err.status === 404 ? { status: 'notFound' } : { status: 'error' },
        })
      },
    )

    return () => controller.abort()
  }, [lobbyId])

  const state: LoadState | undefined = result?.lobbyId === lobbyId ? result.state : undefined

  const lobbyName = state?.status === 'loaded' ? state.data.summary.name : undefined
  useCorrectLobbySlug(lobbyId, lobbyName)

  let content: React.ReactNode
  if (!state) {
    content = <LoadingDotsArea />
  } else {
    switch (state.status) {
      case 'notFound':
        content = <NotFoundState />
        break
      case 'error':
        content = <ErrorState />
        break
      case 'loaded':
        content = <LiveLobby summary={state.data} />
        break
      default:
        content = assertUnreachable(state)
    }
  }

  return <Root $targetWidth={720}>{content}</Root>
}

function NotFoundState() {
  const { t } = useTranslation()

  return (
    <StateMessageLayout>
      <StateMessageIcon icon='other_houses' />
      <BodyLarge>{t('lobbies.landing.notFound', 'This lobby is no longer open.')}</BodyLarge>
      <DownloadCta />
    </StateMessageLayout>
  )
}

function ErrorState() {
  const { t } = useTranslation()

  return (
    <StateMessageLayout>
      <StateMessageIcon icon='cloud_off' />
      <BodyLarge>
        {t('lobbies.landing.loadError', 'There was a problem loading this lobby.')}
      </BodyLarge>
      <DownloadCta />
    </StateMessageLayout>
  )
}

function LiveLobby({ summary }: { summary: LobbySummaryResponse }) {
  const { t } = useTranslation()
  const { summary: lobby, host } = summary

  return (
    <>
      <LobbyName>{lobby.name}</LobbyName>
      <InfoLayout>
        <MapThumbnailContainer>
          <MapThumbnail map={lobby.map} size={MAP_THUMBNAIL_SIZE} />
        </MapThumbnailContainer>
        <DetailsList>
          <DetailRow>
            <DetailLabel>{t('lobbies.landing.mapLabel', 'Map')}</DetailLabel>
            <DetailValue>{lobby.map.name}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>{t('lobbies.landing.hostLabel', 'Host')}</DetailLabel>
            <DetailValue>{host.name}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>{t('lobbies.landing.gameTypeLabel', 'Game type')}</DetailLabel>
            <DetailValue>{gameTypeToLabel(lobby.gameType, t)}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>{t('lobbies.landing.slotsLabel', 'Slots')}</DetailLabel>
            <DetailValue>
              {t('lobbies.landing.openSlotCount', {
                defaultValue: '{{count}} open',
                count: lobby.openSlotCount,
              })}
            </DetailValue>
          </DetailRow>
        </DetailsList>
      </InfoLayout>
      <DownloadCta showAppHint={true} />
    </>
  )
}

function DownloadCta({ showAppHint = false }: { showAppHint?: boolean }) {
  const { t } = useTranslation()

  return (
    <CtaLayout>
      <LinkButton href='/download'>
        <FilledButton
          styledAs='div'
          label={t('lobbies.landing.download', 'Download ShieldBattery')}
          iconStart={<MaterialIcon icon='download' />}
        />
      </LinkButton>
      {showAppHint ? (
        <AppHint>
          {t(
            'lobbies.landing.openInApp',
            'Already have ShieldBattery? Open this link from inside the app to join the lobby.',
          )}
        </AppHint>
      ) : null}
    </CtaLayout>
  )
}
