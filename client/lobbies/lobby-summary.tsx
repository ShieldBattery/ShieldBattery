import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { gameTypeToLabel } from '../../common/games/game-type'
import { LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../common/urls'
import { MapThumbnail } from '../maps/map-thumbnail'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { bodyLarge, HeadlineMedium, labelMedium } from '../styles/typography'

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

/**
 * The load state of a lobby summary fetch (see `useLobbySummary`).
 */
export type LobbySummaryLoadState =
  { status: 'loaded'; data: LobbySummaryResponse } | { status: 'notFound' } | { status: 'error' }

/**
 * Fetches the unauthenticated lobby summary (`GET /api/1/lobbies/:lobbyId/summary`) for `lobbyId`.
 * Returns a tuple of the load state (undefined while the fetch for the current `lobbyId` is in
 * flight) and a `refresh` function that re-runs the fetch for the current `lobbyId`.
 *
 * The result is tagged with the lobby id it was fetched for, so a stale result from a previous id
 * (e.g. if `lobbyId` changes without the caller unmounting) is never rendered as current -- the
 * state stays undefined until a result tagged with the current id arrives. A `refresh` doesn't
 * clear the existing result, so the previous state remains rendered until the new one lands. If a
 * refresh fails for a reason other than a 404, the last successfully loaded summary is kept
 * instead of being downgraded to the error state.
 */
export function useLobbySummary(
  lobbyId: SbLobbyId,
): [state: LobbySummaryLoadState | undefined, refresh: () => void] {
  const [result, setResult] = useState<{ lobbyId: string; state: LobbySummaryLoadState }>()
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    fetchJson<LobbySummaryResponse>(apiUrl`lobbies/${lobbyId}/summary`, {
      signal: controller.signal,
    }).then(
      data => {
        if (controller.signal.aborted) {
          return
        }
        setResult({ lobbyId, state: { status: 'loaded', data } })
      },
      err => {
        if (controller.signal.aborted) {
          return
        }
        const state: LobbySummaryLoadState =
          isFetchError(err) && err.status === 404 ? { status: 'notFound' } : { status: 'error' }
        setResult(prev =>
          // A lobby that's still loadable shouldn't lose its rendered details to a transient
          // failure; only a 404 (definitively gone) replaces a loaded summary.
          state.status === 'error' && prev?.lobbyId === lobbyId && prev.state.status === 'loaded'
            ? prev
            : { lobbyId, state },
        )
      },
    )

    return () => controller.abort()
  }, [lobbyId, refreshToken])

  const refresh = () => setRefreshToken(t => t + 1)

  return [result?.lobbyId === lobbyId ? result.state : undefined, refresh]
}

/**
 * Renders a lobby's name and key details (map, host, game type, open slot count) from its
 * unauthenticated summary. Shared by the logged-out web landing page and the in-app join preview.
 */
export function LobbySummaryDetails({ summary }: { summary: LobbySummaryResponse }) {
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
            <DetailLabel>{t('lobbies.summary.mapLabel', 'Map')}</DetailLabel>
            <DetailValue>{lobby.map.name}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>{t('lobbies.summary.hostLabel', 'Host')}</DetailLabel>
            <DetailValue>{host.name}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>{t('lobbies.summary.gameTypeLabel', 'Game type')}</DetailLabel>
            <DetailValue>{gameTypeToLabel(lobby.gameType, t)}</DetailValue>
          </DetailRow>
          <DetailRow>
            <DetailLabel>{t('lobbies.summary.slotsLabel', 'Slots')}</DetailLabel>
            <DetailValue>
              {t('lobbies.summary.openSlotCount', {
                defaultValue: '{{count}} open',
                count: lobby.openSlotCount,
              })}
            </DetailValue>
          </DetailRow>
        </DetailsList>
      </InfoLayout>
    </>
  )
}
