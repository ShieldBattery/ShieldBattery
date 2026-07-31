import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { gameTypeToLabel } from '../../common/games/game-type'
import { LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { lobbyIdFromPath } from '../../common/lobbies/lobby-url'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { apiUrl } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FilledButton } from '../material/button'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { LobbySummaryLoadState } from './lobby-summary'
import { navigateToLobby } from './lobby-url'

/**
 * Returns the lobby id embedded in a chat message link, or undefined if the link isn't a
 * ShieldBattery lobby link (an external URL, or a ShieldBattery URL for something other than a
 * lobby).
 */
export function lobbyIdFromMessageLink(href: string): SbLobbyId | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  return isShieldBatteryUrl(url) ? lobbyIdFromPath(url.pathname) : undefined
}

/** How long a fetched summary is shared between all the cards that want it. */
const SUMMARY_SHARE_MS = 30 * 1000

const summaryCache = new Map<
  SbLobbyId,
  { expiresAt: number; promise: Promise<LobbySummaryLoadState> }
>()

/**
 * Fetches a lobby's summary through a short-lived shared cache. The same lobby link often appears
 * in many rendered messages at once (repeated pastes, history pages, the full message list
 * remounting on a channel switch), and each message's card mounts its own fetch -- sharing the
 * result collapses those into one request per lobby per window instead of N identical hits against
 * the summary endpoint's IP throttle. Transient failures aren't kept, so a later mount retries.
 */
function fetchSummaryShared(lobbyId: SbLobbyId): Promise<LobbySummaryLoadState> {
  const now = Date.now()
  const cached = summaryCache.get(lobbyId)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = fetchJson<LobbySummaryResponse>(apiUrl`lobbies/${lobbyId}/summary`).then(
    (data): LobbySummaryLoadState => ({ status: 'loaded', data }),
    (err): LobbySummaryLoadState => {
      if (isFetchError(err) && err.status === 404) {
        return { status: 'notFound' }
      }
      summaryCache.delete(lobbyId)
      return { status: 'error' }
    },
  )
  summaryCache.set(lobbyId, { expiresAt: now + SUMMARY_SHARE_MS, promise })
  return promise
}

/**
 * The card-oriented counterpart to `useLobbySummary`: same load states, but reads through
 * {@link fetchSummaryShared} so simultaneous cards for the same lobby share one request. The
 * result is tagged with the lobby id it was fetched for, so a stale result from a previous id is
 * never rendered as current.
 */
function useSharedLobbySummary(lobbyId: SbLobbyId): LobbySummaryLoadState | undefined {
  const [result, setResult] = useState<{ lobbyId: SbLobbyId; state: LobbySummaryLoadState }>()

  useEffect(() => {
    let canceled = false
    fetchSummaryShared(lobbyId)
      .then(state => {
        if (!canceled) {
          setResult({ lobbyId, state })
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      canceled = true
    }
  }, [lobbyId])

  return result?.lobbyId === lobbyId ? result.state : undefined
}

// Aligns the card under the message text: `MessageContainer` (message-layout.tsx) uses
// `padding: 4px 8px 4px 72px`, where the 72px left padding is the timestamp column that message
// text starts after.
const CARD_MARGIN = '4px 8px 4px 72px'
const CARD_MAX_WIDTH = 440

const CardRoot = styled.div`
  width: fit-content;
  max-width: ${CARD_MAX_WIDTH}px;
  margin: ${CARD_MARGIN};
  padding: 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const GoneCard = styled.div`
  ${bodySmall};
  ${singleLine};
  width: fit-content;
  max-width: ${CARD_MAX_WIDTH}px;
  margin: ${CARD_MARGIN};
  padding: 8px 12px;

  color: var(--theme-on-surface-variant);
  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const THUMBNAIL_SIZE = 64

const ThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${THUMBNAIL_SIZE}px;
`

const InfoColumn = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const LobbyName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const SecondaryLine = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

/**
 * The presentational part of {@link LobbyInviteCard}: renders the loading/notFound/error/loaded
 * states without fetching anything itself, so it can be driven directly (e.g. from a devonly test
 * page) without racing a real lobby.
 */
export function LobbyInviteCardContent({
  state,
  onJoinClick,
}: {
  state: LobbySummaryLoadState | undefined
  onJoinClick: () => void
}) {
  const { t } = useTranslation()

  if (!state || state.status === 'error') {
    // The inline link in the message text is still rendered and still works, so there's nothing
    // useful to show here while loading or if the preview couldn't be loaded.
    return null
  }

  if (state.status === 'notFound') {
    return <GoneCard>{t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')}</GoneCard>
  }

  const { summary: lobby, host } = state.data

  return (
    <CardRoot>
      <ThumbnailContainer>
        <MapThumbnail map={lobby.map} size={THUMBNAIL_SIZE} />
      </ThumbnailContainer>
      <InfoColumn>
        <LobbyName title={lobby.name}>{lobby.name}</LobbyName>
        <SecondaryLine>
          {host.name} · {gameTypeToLabel(lobby.gameType, t)} ·{' '}
          {t('lobbies.summary.openSlotCount', {
            defaultValue: '{{count}} open',
            count: lobby.openSlotCount,
          })}
        </SecondaryLine>
      </InfoColumn>
      <FilledButton
        label={t('lobbies.joinLobby.action', 'Join lobby')}
        onClick={onJoinClick}
        testName='lobby-invite-card-join-button'
      />
    </CardRoot>
  )
}

/**
 * A rich invite preview for a lobby link posted in chat: the lobby's map, name, host, game type,
 * and open slot count, with a button to join it. Renders nothing while the summary is loading or
 * if it fails to load for a reason other than the lobby being gone (the inline link in the message
 * text is unaffected either way).
 */
export function LobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const dispatch = useAppDispatch()
  const state = useSharedLobbySummary(lobbyId)

  const onJoinClick = () => {
    if (IS_ELECTRON) {
      // The join preview page at this route handles the actual join attempt (and its errors).
      navigateToLobby(lobbyId, state?.status === 'loaded' ? state.data.summary.name : undefined)
    } else {
      dispatch(openDialog({ type: DialogType.Download }))
    }
  }

  return <LobbyInviteCardContent state={state} onJoinClick={onJoinClick} />
}
