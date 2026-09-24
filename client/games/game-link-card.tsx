import { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameRecordJson, GetGameResponse, getGameTypeLabel } from '../../common/games/games'
import { MapInfoJson } from '../../common/maps'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { dispatch } from '../dispatch-registry'
import { longTimestamp } from '../i18n/date-formats'
import { openMapPreviewDialog } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { OutlinedButton } from '../material/button'
import {
  getInlineCardHeight,
  INLINE_CARD_INFO_GAP,
  INLINE_CARD_THUMBNAIL_SIZE,
  InlineCardGone,
  InlineCardInfoColumn,
  InlineCardLoading,
  InlineCardRoot,
  InlineCardSecondaryLine,
  InlineCardTitle,
} from '../messaging/inline-card'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { navigateToGameResults } from './action-creators'
import { ResultsSubPage } from './results-sub-page'
import { gameFromPath } from './route-game-id'

/** The game a chat message link points at, and the results tab it links to (if any). */
export interface GameLinkTarget {
  gameId: string
  subPage: ResultsSubPage | undefined
}

/**
 * Returns the game a chat message link points at, or undefined if the link isn't a ShieldBattery
 * game results link (an external URL, or a ShieldBattery URL for something other than a game).
 */
export function gameFromMessageLink(href: string): GameLinkTarget | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  return isShieldBatteryUrl(url) ? gameFromPath(url.pathname) : undefined
}

/**
 * Why a game link card has nothing to show: the game doesn't exist, or it couldn't be loaded right
 * now (a transient failure, or the fetch budget below was spent).
 */
type GameLinkFailure = 'notFound' | 'error'

/**
 * Fetches for game link cards that are in flight, plus games known not to exist. Loaded games aren't
 * kept here: they land in the Redux store, which every card reads from first.
 */
const gameLinkFetches = new Map<string, Promise<GameLinkFailure | undefined>>()

/**
 * How many game fetches rendered game links may start per window. Message text is
 * sender-controlled, so a history page full of distinct game links must not be able to fan out one
 * request each against the game endpoint's per-user throttle, which also serves the viewer's own
 * browsing of results pages and the replay library. The budget covers a realistically link-heavy
 * channel in one window while leaving most of that throttle for direct views.
 */
const GAME_FETCH_BUDGET = 10
const GAME_FETCH_BUDGET_WINDOW_MS = 30 * 1000

let budgetWindowStart = 0
let budgetUsed = 0

function takeGameFetchBudget(now: number): boolean {
  if (now - budgetWindowStart >= GAME_FETCH_BUDGET_WINDOW_MS) {
    budgetWindowStart = now
    budgetUsed = 0
  }
  if (budgetUsed >= GAME_FETCH_BUDGET) {
    return false
  }
  budgetUsed += 1
  return true
}

/** Clears the shared fetch state and budget, so tests don't depend on each other. */
export function resetGameLinkFetchesForTesting() {
  gameLinkFetches.clear()
  budgetWindowStart = 0
  budgetUsed = 0
}

/**
 * Loads a game into the Redux store for a game link card, resolving to why it couldn't be, or
 * undefined once it has been. Every card for the same game shares one fetch. A 404 stays cached,
 * since a game that doesn't exist never will; any other failure is evicted so a later card retries.
 */
function loadGameForLink(gameId: string): Promise<GameLinkFailure | undefined> {
  const existing = gameLinkFetches.get(gameId)
  if (existing) {
    return existing
  }

  if (!takeGameFetchBudget(Date.now())) {
    // Not cached, so a denied card that remounts (e.g. its channel is reopened) tries again against
    // whatever budget exists then. Until then it renders nothing, while its message's inline link
    // keeps working.
    return Promise.resolve('error')
  }

  const promise = fetchJson<GetGameResponse>(apiUrl`games/${gameId}`).then(
    (payload): GameLinkFailure | undefined => {
      gameLinkFetches.delete(gameId)
      dispatch({ type: '@games/getGameRecord', payload })
      return undefined
    },
    (err): GameLinkFailure => {
      if (isFetchError(err) && err.status === 404) {
        return 'notFound'
      }
      gameLinkFetches.delete(gameId)
      return 'error'
    },
  )
  gameLinkFetches.set(gameId, promise)
  return promise
}

/**
 * The load state of a game link card: the game's data once it's in the store, or why it can't be
 * shown.
 */
export type GameLinkLoadState =
  | {
      status: 'loaded'
      game: ReadonlyDeep<GameRecordJson>
      map: ReadonlyDeep<MapInfoJson> | undefined
    }
  | { status: 'notFound' }
  | { status: 'error' }

/**
 * Reads a linked game from the Redux store, fetching it (see {@link loadGameForLink}) only when the
 * store doesn't already hold the game and its players, e.g. from the viewer's match history or an
 * earlier card. Returns undefined while that fetch is in flight.
 */
function useGameLinkState(gameId: string): GameLinkLoadState | undefined {
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const map = useAppSelector(s => (game ? s.maps.byId.get(game.mapId) : undefined))
  const playersKnown = useAppSelector(
    s =>
      game !== undefined &&
      game.config.teams.flat().every(p => p.isComputer || s.users.byId.has(p.id)),
  )
  // How this card's own fetch ended. A successful fetch counts as loaded even if some player is
  // still unknown afterwards (e.g. a since-deleted account), so the card never waits on a user the
  // server didn't return.
  const [settled, setSettled] = useState<{ gameId: string; failure: GameLinkFailure | undefined }>()

  useEffect(() => {
    if (playersKnown) {
      return undefined
    }

    // The fetch is shared across every card showing this game, so it can't be aborted just because
    // this card goes away -- only ignore a result that arrives after that happens.
    let canceled = false
    loadGameForLink(gameId)
      .then(failure => {
        if (!canceled) {
          setSettled({ gameId, failure })
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      canceled = true
    }
  }, [gameId, playersKnown])

  const ownResult = settled?.gameId === gameId ? settled : undefined
  if (game && (playersKnown || (ownResult && !ownResult.failure))) {
    return { status: 'loaded', game, map }
  }
  if (ownResult?.failure === 'notFound') {
    return { status: 'notFound' }
  }
  return ownResult?.failure === 'error' ? { status: 'error' } : undefined
}

// The info column stacks 3 rows (players, game type/map, start time) separated by the shared info
// gap; their combined height comes straight from the typography tokens those rows render with
// (`titleSmall`/`bodySmall`'s `line-height`, see client/styles/typography.ts).
const PLAYERS_LINE_HEIGHT = 20 // titleSmall
const SECONDARY_LINE_HEIGHT = 16 // bodySmall
const INFO_STACK_HEIGHT = PLAYERS_LINE_HEIGHT + SECONDARY_LINE_HEIGHT * 2 + INLINE_CARD_INFO_GAP * 2

const CARD_HEIGHT = getInlineCardHeight(INFO_STACK_HEIGHT)

const ThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${INLINE_CARD_THUMBNAIL_SIZE}px;
  /* The thumbnail's no-image fallback sizes itself to its (larger) placeholder icon rather than
   * the requested size, so both axes are pinned and the excess clipped to keep the card's fixed
   * height holding for maps without a generated image. */
  height: ${INLINE_CARD_THUMBNAIL_SIZE}px;
  overflow: hidden;
`

// A long players line gives the info column a large flex basis that would otherwise shrink the
// button past its label; the players line is the one that truncates instead.
const ViewButton = styled(OutlinedButton)`
  flex-shrink: 0;
`

/**
 * Names a game's players, team by team: `A vs B` for a 1v1, `A, B vs C, D` for teams.
 */
function getPlayersText(
  game: ReadonlyDeep<GameRecordJson>,
  usersById: ReadonlyMap<SbUserId, { name: string }>,
  t: TFunction,
): string {
  const separator = ` ${t('game.filters.vs', 'vs')} `
  return game.config.teams
    .map(team =>
      team
        .map(p =>
          p.isComputer
            ? t('game.playerName.computer', 'Computer')
            : (usersById.get(p.id)?.name ?? ''),
        )
        .join(', '),
    )
    .join(separator)
}

/**
 * The presentational part of {@link GameLinkCard}: renders the loading/notFound/error/loaded states
 * without fetching anything itself.
 *
 * The card deliberately leaves out the game's outcome and length: a link is often shared so that
 * someone can go watch the game, and either would spoil it for them.
 *
 * The loading state renders a placeholder sized to match the loaded card so the message it's
 * attached to doesn't grow again once the game arrives. The error state renders nothing: the inline
 * link in the message text still works, and shrinking away is safe (only growth breaks the message
 * list's autoscroll).
 */
export function GameLinkCardContent({
  state,
  usersById,
  onViewClick,
}: {
  state: GameLinkLoadState | undefined
  usersById: ReadonlyMap<SbUserId, { name: string }>
  onViewClick: () => void
}) {
  const { t } = useTranslation()
  const reduxDispatch = useAppDispatch()

  if (!state) {
    return <InlineCardLoading $height={CARD_HEIGHT} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'notFound') {
    return (
      <InlineCardGone>{t('gameDetails.notFound', 'This game could not be found.')}</InlineCardGone>
    )
  }

  const { game, map } = state
  const playersText = getPlayersText(game, usersById, t)
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')
  const gameTypeAndMap = `${getGameTypeLabel(game, t)} · ${mapName}`
  const startTime = longTimestamp.format(game.startTime)

  return (
    <InlineCardRoot $height={CARD_HEIGHT}>
      <ThumbnailContainer>
        {map ? (
          <MapThumbnail
            map={map}
            size={INLINE_CARD_THUMBNAIL_SIZE}
            forceAspectRatio={1}
            onPreview={() => reduxDispatch(openMapPreviewDialog(map.id))}
          />
        ) : null}
      </ThumbnailContainer>
      <InlineCardInfoColumn>
        <InlineCardTitle title={playersText}>{playersText}</InlineCardTitle>
        <InlineCardSecondaryLine title={gameTypeAndMap}>{gameTypeAndMap}</InlineCardSecondaryLine>
        <InlineCardSecondaryLine title={startTime}>{startTime}</InlineCardSecondaryLine>
      </InlineCardInfoColumn>
      <ViewButton
        label={t('games.linkCard.view', 'View game')}
        onClick={onViewClick}
        testName='game-link-card-view-button'
      />
    </InlineCardRoot>
  )
}

/**
 * A rich preview for a game results link posted in chat: the game's map, players, type, and start
 * time, with a button to open its results page (on the tab the link points at).
 */
export function GameLinkCard({ target }: { target: GameLinkTarget }) {
  const state = useGameLinkState(target.gameId)
  const usersById = useAppSelector(s => s.users.byId)

  return (
    <GameLinkCardContent
      state={state}
      usersById={usersById}
      onViewClick={() => navigateToGameResults(target.gameId, false, target.subPage)}
    />
  )
}
