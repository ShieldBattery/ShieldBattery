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
 * The load state of a lobby summary fetch, tagged with the lobby id it belongs to (see
 * `useLobbySummary`).
 */
export type LobbySummaryLoadState =
  { status: 'loaded'; data: LobbySummaryResponse } | { status: 'notFound' } | { status: 'error' }

/**
 * Fetches the unauthenticated lobby summary (`GET /api/1/lobbies/:lobbyId/summary`) for `lobbyId`.
 * Returns undefined while the fetch for the current `lobbyId` is in flight.
 *
 * The result is tagged with the lobby id it was fetched for, so a stale result from a previous id
 * (e.g. if `lobbyId` changes without the caller unmounting) is never rendered as current -- the
 * state stays undefined until a result tagged with the current id arrives.
 */
export function useLobbySummary(lobbyId: SbLobbyId): LobbySummaryLoadState | undefined {
  const [result, setResult] = useState<{ lobbyId: string; state: LobbySummaryLoadState }>()

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

  return result?.lobbyId === lobbyId ? result.state : undefined
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
