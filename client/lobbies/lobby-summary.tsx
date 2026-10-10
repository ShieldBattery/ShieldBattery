import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { gameTypeToLabel } from '../../common/games/game-type'
import { isLaunchingLifecycle, LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../common/urls'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FetchBudget } from '../network/fetch-budget'
import { bodyLarge, HeadlineMedium, labelMedium } from '../styles/typography'
import { LobbyFetchCache, LobbyLoadState, useLobbyFetch } from './lobby-fetch-cache'

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
export type LobbySummaryLoadState = LobbyLoadState<LobbySummaryResponse>

/**
 * How many cache-missing cached reads may actually hit the network per window. Cached reads are
 * driven by rendered content (chat-message lobby links), and message text is sender-controlled:
 * a history page full of distinct lobby-shaped ids must not be able to fan out one request each,
 * both because of the summary endpoint's per-IP throttle (whose budget also serves the join
 * preview and web landing page) and because none of those requests are the user's own doing. The
 * budget is sized to cover a realistically lobby-link-heavy channel in one window, while leaving
 * the rest of the endpoint's sustained per-IP rate (plus its burst allowance) as headroom for
 * direct, user-initiated summary views.
 */
const summaryFetchBudget = new FetchBudget(15, 30 * 1000)

const summaryCache = new LobbyFetchCache<LobbySummaryResponse>(
  lobbyId => apiUrl`lobbies/${lobbyId}/summary`,
  summaryFetchBudget,
)

/** Clears the shared summary cache and fetch budget, so tests don't depend on each other. */
export function resetSummaryCacheForTesting() {
  summaryCache.reset()
}

/**
 * Fetches the unauthenticated lobby summary (`GET /api/1/lobbies/:lobbyId/summary`) for `lobbyId`,
 * either directly or through the shared cache described in {@link LobbyFetchCache}.
 */
export function fetchLobbySummary(
  lobbyId: SbLobbyId,
  options: { cached?: false; signal?: AbortSignal } | { cached: true } = {},
): Promise<LobbySummaryLoadState> {
  return summaryCache.fetch(lobbyId, options)
}

/**
 * Loads a lobby's unauthenticated summary, with the load and refresh semantics described in
 * {@link useLobbyFetch}.
 */
export function useLobbySummary(
  lobbyId: SbLobbyId,
  options?: { cached?: boolean },
): [state: LobbySummaryLoadState | undefined, refresh: () => void] {
  return useLobbyFetch(summaryCache, lobbyId, options)
}

/**
 * What the details list shows for slots: how many are open, or -- when the lobby isn't taking
 * anyone into a seat right now -- what it's doing instead.
 */
function slotsValueFor(lobby: LobbySummaryResponse['summary'], t: TFunction): string {
  if (lobby.lifecycle === 'inGame') {
    return t('lobbies.lobby.inGame', 'In game')
  }
  if (isLaunchingLifecycle(lobby.lifecycle)) {
    return t('lobbies.summary.startingGame', 'Starting game')
  }
  return t('lobbies.summary.openSlotCount', {
    defaultValue: '{{count}} open',
    count: lobby.playerSlots.open,
  })
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
            <DetailValue>{slotsValueFor(lobby, t)}</DetailValue>
          </DetailRow>
        </DetailsList>
      </InfoLayout>
    </>
  )
}
