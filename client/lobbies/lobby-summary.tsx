import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
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

/** How long a cached summary fetch is shared between callers that opt into caching. */
const SUMMARY_CACHE_MS = 30 * 1000

const summaryCache = new Map<
  SbLobbyId,
  { expiresAt: number; promise: Promise<LobbySummaryLoadState> }
>()

/**
 * How many cache-missing cached reads may actually hit the network per window. Cached reads are
 * driven by rendered content (chat-message lobby links), and message text is sender-controlled:
 * a history page full of distinct lobby-shaped ids must not be able to fan out one request each,
 * both because of the summary endpoint's per-IP throttle (whose budget also serves the join
 * preview and web landing page) and because none of those requests are the user's own doing. The
 * budget is deliberately below the endpoint's sustained rate so direct, user-initiated summary
 * views keep working even while at it. Reads past the budget aren't dropped -- they wait for the
 * next window (see the denial branch below) -- so the budget shapes traffic rather than deciding
 * which cards ever load.
 */
const SUMMARY_FETCH_BUDGET = 10
const SUMMARY_FETCH_BUDGET_WINDOW_MS = 30 * 1000

let budgetWindowStart = 0
let budgetUsed = 0

/** Consumes one unit of the cached-read fetch budget, returning whether any budget remained. */
function takeSummaryFetchBudget(now: number): boolean {
  if (now - budgetWindowStart >= SUMMARY_FETCH_BUDGET_WINDOW_MS) {
    budgetWindowStart = now
    budgetUsed = 0
  }
  if (budgetUsed >= SUMMARY_FETCH_BUDGET) {
    return false
  }
  budgetUsed += 1
  return true
}

/** Clears the shared summary cache and fetch budget, so tests don't depend on each other. */
export function resetSummaryCacheForTesting() {
  summaryCache.clear()
  budgetWindowStart = 0
  budgetUsed = 0
}

/**
 * Fetches the unauthenticated lobby summary (`GET /api/1/lobbies/:lobbyId/summary`) for `lobbyId`,
 * either directly (`signal` aborts the request the same way a plain `fetchJson` call would) or,
 * with `cached: true`, through a short-lived cache shared by every caller that opts in.
 *
 * Caching exists for call sites where the same lobby can be requested many times at once (e.g. the
 * same lobby link appearing in several rendered chat messages, or a full message list remounting on
 * a channel switch) -- collapsing those into one request per lobby per window avoids fanning out
 * to the summary endpoint's IP throttle. A transient failure (anything other than a 404) isn't
 * cached, so a later caller retries instead of being stuck with the error for the whole window; a
 * 404 is cached like any other result, since a lobby that's gone stays gone.
 */
export function fetchLobbySummary(
  lobbyId: SbLobbyId,
  options: { cached?: false; signal?: AbortSignal } | { cached: true } = {},
): Promise<LobbySummaryLoadState> {
  if (!options.cached) {
    return fetchJson<LobbySummaryResponse>(apiUrl`lobbies/${lobbyId}/summary`, {
      signal: options.signal,
    }).then(
      (data): LobbySummaryLoadState => ({ status: 'loaded', data }),
      (err): LobbySummaryLoadState =>
        isFetchError(err) && err.status === 404 ? { status: 'notFound' } : { status: 'error' },
    )
  }

  const now = Date.now()
  const cached = summaryCache.get(lobbyId)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  // Sweep other expired entries out while we're here -- they're otherwise only replaced when the
  // same lobby is requested again, so the cache would grow unbounded over a long session.
  for (const [id, entry] of summaryCache) {
    if (entry.expiresAt <= now) {
      summaryCache.delete(id)
    }
  }

  if (!takeSummaryFetchBudget(now)) {
    // Over-budget reads wait for the window to refill and then go through the whole read again:
    // that retry can end in a cache hit (someone else fetched this lobby meanwhile), a real fetch,
    // or another wait if the refilled window is exhausted first -- each window drains part of the
    // backlog, so every waiter gets through eventually. The waiter is cached like an in-flight
    // fetch so repeated reads of the same lobby share it, and it evicts itself just before
    // retrying: the retry must see a cache miss (its own entry would otherwise be returned right
    // back to it), and whatever the retry caches -- or deliberately doesn't, for a transient
    // failure -- then stands on its own.
    const waitMs = budgetWindowStart + SUMMARY_FETCH_BUDGET_WINDOW_MS - now
    const promise: Promise<LobbySummaryLoadState> = new Promise<void>(resolve => {
      setTimeout(resolve, waitMs)
    }).then(() => {
      if (summaryCache.get(lobbyId)?.promise === promise) {
        summaryCache.delete(lobbyId)
      }
      return fetchLobbySummary(lobbyId, { cached: true })
    })
    summaryCache.set(lobbyId, { expiresAt: now + waitMs + SUMMARY_CACHE_MS, promise })
    return promise
  }

  const promise: Promise<LobbySummaryLoadState> = fetchJson<LobbySummaryResponse>(
    apiUrl`lobbies/${lobbyId}/summary`,
  ).then(
    (data): LobbySummaryLoadState => {
      // The shared window starts when the response arrives, not when the request started, so a
      // slow fetch doesn't eat into it.
      const entry = summaryCache.get(lobbyId)
      if (entry?.promise === promise) {
        entry.expiresAt = Date.now() + SUMMARY_CACHE_MS
      }
      return { status: 'loaded', data }
    },
    (err): LobbySummaryLoadState => {
      if (isFetchError(err) && err.status === 404) {
        return { status: 'notFound' }
      }
      // Evict only our own entry: a request that outlives its window may fail after a later
      // caller has already repopulated the cache with a fresh in-flight fetch.
      if (summaryCache.get(lobbyId)?.promise === promise) {
        summaryCache.delete(lobbyId)
      }
      return { status: 'error' }
    },
  )
  summaryCache.set(lobbyId, { expiresAt: now + SUMMARY_CACHE_MS, promise })
  return promise
}

/**
 * Loads a lobby's unauthenticated summary. Returns a tuple of the load state (undefined while the
 * fetch for the current `lobbyId` is in flight) and a `refresh` function that re-runs the fetch for
 * the current `lobbyId`.
 *
 * The result is tagged with the lobby id it was fetched for, so a stale result from a previous id
 * (e.g. if `lobbyId` changes without the caller unmounting) is never rendered as current -- the
 * state stays undefined until a result tagged with the current id arrives. A `refresh` doesn't
 * clear the existing result, so the previous state remains rendered until the new one lands. If a
 * refresh fails for a reason other than a 404, the last successfully loaded summary is kept instead
 * of being downgraded to the error state.
 *
 * Pass `cached: true` to read through the shared cache described in {@link fetchLobbySummary}
 * instead of always hitting the network -- appropriate for call sites where the same lobby can be
 * requested many times at once and an eventually-consistent summary is fine. Note that this makes
 * `refresh` effectively a no-op for the rest of the cache window: it re-runs the read, but the
 * read is handed the same cached result back. Leave `cached` unset for a single authoritative view
 * (e.g. the join preview) that should always see the current state and control its own refreshes.
 */
export function useLobbySummary(
  lobbyId: SbLobbyId,
  options?: { cached?: boolean },
): [state: LobbySummaryLoadState | undefined, refresh: () => void] {
  const cached = options?.cached ?? false
  const [result, setResult] = useState<{ lobbyId: SbLobbyId; state: LobbySummaryLoadState }>()
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (cached) {
      // The fetch itself is shared across every mount currently requesting this lobby, so it can't
      // be aborted just because this particular mount goes away -- only ignore a result that
      // arrives after that happens.
      let canceled = false
      fetchLobbySummary(lobbyId, { cached: true })
        .then(state => {
          if (!canceled) {
            setResult({ lobbyId, state })
          }
        })
        .catch(swallowNonBuiltins)

      return () => {
        canceled = true
      }
    }

    const controller = new AbortController()

    fetchLobbySummary(lobbyId, { signal: controller.signal })
      .then(state => {
        if (controller.signal.aborted) {
          return
        }
        setResult(prev =>
          // A lobby that's still loadable shouldn't lose its rendered details to a transient
          // failure; only a 404 (definitively gone) replaces a loaded summary.
          state.status === 'error' && prev?.lobbyId === lobbyId && prev.state.status === 'loaded'
            ? prev
            : { lobbyId, state },
        )
      })
      .catch(swallowNonBuiltins)

    return () => controller.abort()
  }, [lobbyId, refreshToken, cached])

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
