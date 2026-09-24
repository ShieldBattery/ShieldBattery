import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameSource } from '../../common/games/configuration'
import { GameRecordJson, GetGameResponse, getGameTypeLabel } from '../../common/games/games'
import { MapInfoJson } from '../../common/maps'
import { getDivisionBeforeRatingChange, MatchmakingDivision } from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { dispatch as globalDispatch } from '../dispatch-registry'
import { longTimestamp } from '../i18n/date-formats'
import { openMapPreviewDialog } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { OutlinedButton } from '../material/button'
import {
  INLINE_CARD_BORDER_WIDTH,
  INLINE_CARD_PADDING,
  INLINE_CARD_THUMBNAIL_SIZE,
  inlineCardBase,
  InlineCardGone,
  InlineCardLoading,
} from '../messaging/inline-card'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodySmall, singleLine } from '../styles/typography'
import { navigateToGameResults } from './action-creators'
import { GamePlayersDisplay } from './game-players-display'
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
      globalDispatch({ type: '@games/getGameRecord', payload })
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
      /** For a matchmaking game, the division each player was in going into it. */
      divisionById: ReadonlyMap<SbUserId, MatchmakingDivision> | undefined
    }
  | { status: 'notFound' }
  | { status: 'error' }

/**
 * Reads a linked game from the Redux store, fetching it (see {@link loadGameForLink}) only when the
 * store doesn't already hold everything the card shows: the game, its players, and for a
 * matchmaking game the bonus pool its ranks are placed with (which only a single-game fetch
 * loads). Returns undefined while that fetch is in flight.
 */
function useGameLinkState(gameId: string): GameLinkLoadState | undefined {
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const map = useAppSelector(s => (game ? s.maps.byId.get(game.mapId) : undefined))
  const playersKnown = useAppSelector(
    s =>
      game !== undefined &&
      game.config.teams.flat().every(p => p.isComputer || s.users.byId.has(p.id)),
  )
  const mmrChanges = useAppSelector(s => s.games.mmrChangesById.get(gameId))
  const rankBonusPool = useAppSelector(s => s.games.rankBonusPoolById.get(gameId))
  const isRanked = game?.config.gameSource === GameSource.Matchmaking
  const detailsKnown = playersKnown && (!isRanked || rankBonusPool !== undefined)
  // How this card's own fetch ended. A successful fetch counts as loaded even if some detail is
  // still missing afterwards (e.g. a since-deleted account), so the card never waits on something
  // the server didn't return.
  const [settled, setSettled] = useState<{ gameId: string; failure: GameLinkFailure | undefined }>()

  useEffect(() => {
    if (detailsKnown) {
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
  }, [gameId, detailsKnown])

  const ownResult = settled?.gameId === gameId ? settled : undefined
  if (game && (detailsKnown || (ownResult && !ownResult.failure))) {
    const divisionById =
      isRanked && mmrChanges && rankBonusPool !== undefined
        ? new Map(
            Array.from(
              mmrChanges.values(),
              change =>
                [change.userId, getDivisionBeforeRatingChange(change, rankBonusPool)] as const,
            ),
          )
        : undefined
    return { status: 'loaded', game, map, divisionById }
  }
  if (ownResult?.failure === 'notFound') {
    return { status: 'notFound' }
  }
  return ownResult?.failure === 'error' ? { status: 'error' } : undefined
}

const CARD_GAP = 8
const HEADER_LINE_HEIGHT = 16 // bodySmall
// Row metrics of `PlayerTeamsDisplay` (client/games/player-teams-display.tsx).
const ROSTER_ROW_HEIGHT = 20
const ROSTER_ROW_GAP = 8
const VIEW_BUTTON_HEIGHT = 40
/**
 * The most rows a roster renders: a game holds at most 8 players, which the roster lays out in at
 * most two columns.
 */
const MAX_ROSTER_ROWS = 4

/**
 * Returns the height a card renders at for a roster of `rows` rows: the header line over whichever
 * is taller of the map thumbnail or the roster with the view button under it, plus the card's own
 * padding and border. The loading placeholder reserves the tallest roster, so a loaded card only
 * ever keeps or shrinks the space its placeholder took.
 */
function getCardHeight(rows: number): number {
  const rosterHeight = rows * ROSTER_ROW_HEIGHT + (rows - 1) * ROSTER_ROW_GAP
  const bodyHeight = Math.max(
    INLINE_CARD_THUMBNAIL_SIZE,
    rosterHeight + CARD_GAP + VIEW_BUTTON_HEIGHT,
  )
  return (
    HEADER_LINE_HEIGHT +
    CARD_GAP +
    bodyHeight +
    INLINE_CARD_PADDING * 2 +
    INLINE_CARD_BORDER_WIDTH * 2
  )
}

const GameCardRoot = styled.div<{ $height: number }>`
  ${inlineCardBase};
  height: ${props => props.$height}px;
  padding: ${INLINE_CARD_PADDING}px;

  display: flex;
  flex-direction: column;
  gap: ${CARD_GAP}px;
`

const Header = styled.div`
  ${bodySmall};
  ${singleLine};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const Body = styled.div`
  min-height: 0;

  display: flex;
  align-items: flex-start;
  gap: 12px;
`

const ThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${INLINE_CARD_THUMBNAIL_SIZE}px;
  /* The thumbnail's no-image fallback sizes itself to its (larger) placeholder icon rather than
   * the requested size, so both axes are pinned and the excess clipped to keep the card's fixed
   * height holding for maps without a generated image. */
  height: ${INLINE_CARD_THUMBNAIL_SIZE}px;
  overflow: hidden;
`

const RosterColumn = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: ${CARD_GAP}px;
`

const ViewButton = styled(OutlinedButton)`
  align-self: flex-end;
`

/**
 * The presentational part of {@link GameLinkCard}: renders the loading/notFound/error/loaded states
 * without fetching anything itself.
 *
 * The card deliberately leaves out the game's outcome and length (and each player's points change):
 * a link is often shared so that someone can go watch the game, and any of those would spoil it.
 * The ranks shown are the ones players had going into the game, which give nothing away.
 *
 * The loading state renders a placeholder sized for the largest roster, so the message it's
 * attached to never grows once the game arrives. The error state renders nothing: the inline link
 * in the message text still works, and shrinking away is safe (only growth breaks the message
 * list's autoscroll).
 */
export function GameLinkCardContent({
  state,
  onViewClick,
}: {
  state: GameLinkLoadState | undefined
  onViewClick: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  if (!state) {
    return <InlineCardLoading $height={getCardHeight(MAX_ROSTER_ROWS)} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'notFound') {
    return (
      <InlineCardGone>{t('gameDetails.notFound', 'This game could not be found.')}</InlineCardGone>
    )
  }

  const { game, map, divisionById } = state
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')
  const header = [getGameTypeLabel(game, t), mapName, longTimestamp.format(game.startTime)].join(
    ' · ',
  )
  // The roster deals players into at most two columns, so its longest column holds half of them.
  const playerCount = game.config.teams.reduce((count, team) => count + team.length, 0)
  const rows = Math.min(MAX_ROSTER_ROWS, Math.max(1, Math.ceil(playerCount / 2)))

  return (
    <GameCardRoot $height={getCardHeight(rows)}>
      <Header title={header}>{header}</Header>
      <Body>
        <ThumbnailContainer>
          {map ? (
            <MapThumbnail
              map={map}
              size={INLINE_CARD_THUMBNAIL_SIZE}
              forceAspectRatio={1}
              onPreview={() => dispatch(openMapPreviewDialog(map.id))}
            />
          ) : null}
        </ThumbnailContainer>
        <RosterColumn>
          <GamePlayersDisplay game={game} showTeamLabels={false} divisionById={divisionById} />
          <ViewButton
            label={t('games.linkCard.view', 'View game')}
            onClick={onViewClick}
            testName='game-link-card-view-button'
          />
        </RosterColumn>
      </Body>
    </GameCardRoot>
  )
}

/**
 * A rich preview for a game results link posted in chat: the game's type, map and start time, and
 * its players with the ranks they had going into it, with a button to open its results page (on
 * the tab the link points at).
 */
export function GameLinkCard({ target }: { target: GameLinkTarget }) {
  const state = useGameLinkState(target.gameId)

  return (
    <GameLinkCardContent
      state={state}
      onViewClick={() => navigateToGameResults(target.gameId, false, target.subPage)}
    />
  )
}
