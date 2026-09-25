import { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shallowEqual } from 'react-redux'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameConfig, GameConfigPlayer, GameSource } from '../../common/games/configuration'
import {
  GameRecordJson,
  getGameDurationString,
  GetGameResponse,
  getGameTypeLabel,
} from '../../common/games/games'
import { getTeamsFromConfig } from '../../common/games/matchups'
import { ReconciledPlayerResult } from '../../common/games/results'
import { MapInfoJson } from '../../common/maps'
import {
  getDivisionBeforeRatingChange,
  GetMatchmakingSeasonsResponse,
  getTotalBonusPoolForSeason,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { dispatch as globalDispatch } from '../dispatch-registry'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { DivisionIcon } from '../matchmaking/rank-icon'
import {
  BackdropCard,
  BackdropCardAction,
  BackdropCardGone,
  BackdropCardHeader,
  BackdropCardLoading,
  BackdropCardMeta,
  BackdropCardMetaKeyText,
  BackdropCardMetaText,
  BackdropCardTitle,
  backdropTextShadow,
  CardClickBoundary,
  CardTooltip,
  getBackdropCardHeight,
} from '../messaging/backdrop-card'
import { shieldBatteryPathFromLink } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { FetchBudget } from '../network/fetch-budget'
import { isFetchError } from '../network/fetch-errors'
import { useAppSelector } from '../redux-hooks'
import { bodySmall, labelMedium, singleLine, titleMedium, titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { navigateToGameResults } from './action-creators'
import { PlayerResultMarker } from './result-chip'
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
  const pathname = shieldBatteryPathFromLink(href)
  return pathname !== undefined ? gameFromPath(pathname) : undefined
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
const gameFetchBudget = new FetchBudget(10, 30 * 1000)

/**
 * Games whose link fetch succeeded this session. The fetch returns everything a card shows, so
 * anything such a game still lacks in the store (e.g. the name of a since-deleted player) won't
 * arrive by fetching it again.
 */
const gamesLoadedForLink = new Set<string>()

export function resetGameLinkFetchesForTesting() {
  gameLinkFetches.clear()
  gamesLoadedForLink.clear()
  seasonsFetch = undefined
  gameFetchBudget.reset()
}

/** Returns whether a link fetch for `gameId` (see {@link loadGameForLink}) succeeded this session. */
export function hasLoadedGameForLink(gameId: string): boolean {
  return gamesLoadedForLink.has(gameId)
}

/**
 * Loads a game into the Redux store for a game link card, resolving to why it couldn't be, or
 * undefined once it has been. Every card for the same game shares one fetch. A 404 stays cached,
 * since a game that doesn't exist never will; any other failure is evicted so a later card retries.
 */
export function loadGameForLink(gameId: string): Promise<GameLinkFailure | undefined> {
  const existing = gameLinkFetches.get(gameId)
  if (existing) {
    return existing
  }

  if (!gameFetchBudget.take()) {
    // Not cached, so a denied card that remounts (e.g. its channel is reopened) tries again against
    // whatever budget exists then. Until then it renders nothing, while its message's inline link
    // keeps working.
    return Promise.resolve('error')
  }

  const promise = fetchJson<GetGameResponse>(apiUrl`games/${gameId}`).then(
    (payload): GameLinkFailure | undefined => {
      gameLinkFetches.delete(gameId)
      gamesLoadedForLink.add(gameId)
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
 * The fetch of every matchmaking season, shared by every card that needs one. A success stays cached
 * for the session, so a game that falls in no season can't make each card refetch the list; a
 * failure is evicted so a later card retries.
 */
let seasonsFetch: Promise<void> | undefined

/**
 * Loads every matchmaking season into the Redux store, for placing a ranked game's players into the
 * divisions they were in when it was played. Resolves once the fetch settles, whether or not it
 * succeeded.
 */
export function loadMatchmakingSeasons(): Promise<void> {
  if (!seasonsFetch) {
    seasonsFetch = fetchJson<GetMatchmakingSeasonsResponse>(apiUrl`matchmaking/seasons`).then(
      payload => {
        globalDispatch({ type: '@matchmaking/getMatchmakingSeasons', payload })
      },
      () => {
        seasonsFetch = undefined
      },
    )
  }
  return seasonsFetch
}

/** Returns the season that was running at `time`, if it's among `seasons`. */
export function findSeasonAt(
  seasons: Iterable<ReadonlyDeep<MatchmakingSeasonJson>>,
  time: number,
): ReadonlyDeep<MatchmakingSeasonJson> | undefined {
  for (const season of seasons) {
    if (season.startDate <= time && (season.endDate === undefined || time < season.endDate)) {
      return season
    }
  }
  return undefined
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
 * matchmaking game its rating changes (which only a single-game fetch loads). A matchmaking game
 * also needs the season it was played in, whose bonus pool places its players' points into
 * divisions, and loads the seasons (see {@link loadMatchmakingSeasons}) when the store lacks it.
 * Returns undefined while either fetch is in flight.
 *
 * A failed game fetch holds for as long as the card stays mounted, even if the game later lands in
 * the store through another surface: a card that rendered nothing (or a single line) must not grow
 * into a full card, since growth breaks the message list's autoscroll. A remount retries.
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
  const isRanked = game?.config.gameSource === GameSource.Matchmaking
  const season = useAppSelector(s =>
    game && isRanked ? findSeasonAt(s.matchmakingSeasons.byId.values(), game.startTime) : undefined,
  )
  // A game whose link fetch already succeeded counts as known even if some detail is still missing
  // (e.g. a since-deleted account), since fetching it again wouldn't return that detail either.
  const detailsKnown =
    hasLoadedGameForLink(gameId) || (playersKnown && (!isRanked || mmrChanges !== undefined))
  const needsSeasons = isRanked && season === undefined
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

  // Whether this card's seasons fetch has settled. The card goes without ranks if it failed, or if
  // the game predates every season.
  const [seasonsSettledFor, setSeasonsSettledFor] = useState<string>()

  useEffect(() => {
    if (!needsSeasons) {
      return undefined
    }

    let canceled = false
    loadMatchmakingSeasons()
      .then(() => {
        if (!canceled) {
          setSeasonsSettledFor(gameId)
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      canceled = true
    }
  }, [gameId, needsSeasons])

  const ownResult = settled?.gameId === gameId ? settled : undefined
  if (ownResult?.failure) {
    return { status: ownResult.failure }
  }
  if (game && (detailsKnown || ownResult)) {
    if (needsSeasons && seasonsSettledFor !== gameId) {
      return undefined
    }

    const bonusPool =
      isRanked && season ? getTotalBonusPoolForSeason(new Date(game.startTime), season) : undefined
    const divisionById =
      mmrChanges && bonusPool !== undefined
        ? new Map(
            Array.from(
              mmrChanges.values(),
              change => [change.userId, getDivisionBeforeRatingChange(change, bonusPool)] as const,
            ),
          )
        : undefined
    return { status: 'loaded', game, map, divisionById }
  }
  return undefined
}

/**
 * Returns the label for a game's type on a card. Every non-custom game is ranked, so ranked games
 * leave that out and show just their matchmaking type.
 */
function getCardGameTypeLabel(game: ReadonlyDeep<GameRecordJson>, t: TFunction): string {
  return game.config.gameSource === GameSource.Matchmaking
    ? matchmakingTypeToLabel(game.config.gameSourceExtra.type, t)
    : getGameTypeLabel(game, t)
}

const LengthSlot = styled.span`
  ${bodySmall};
  flex-shrink: 0;
  display: inline-grid;
  white-space: pre;
  color: var(--theme-on-surface-variant);
`

/** One of several alternatives stacked in a single grid cell, only one of which is visible. */
const SwapLayer = styled.span<{ $visible: boolean }>`
  grid-area: 1 / 1;
  visibility: ${props => (props.$visible ? 'visible' : 'hidden')};
`

/**
 * A game's length, masked until results are revealed. Both forms occupy the same cell, so the slot
 * is as wide as the wider of them and revealing doesn't move anything around it.
 */
function GameLength({
  game,
  revealed,
  prefix = '',
  className,
}: {
  game: ReadonlyDeep<GameRecordJson>
  revealed: boolean
  /** Text placed ahead of the length (e.g. a separator from what precedes it on its line). */
  prefix?: string
  className?: string
}) {
  if (!game.gameLength) {
    return null
  }

  const text = getGameDurationString(game.gameLength)
  return (
    <LengthSlot className={className}>
      <SwapLayer $visible={revealed}>
        {prefix}
        {text}
      </SwapLayer>
      <SwapLayer $visible={!revealed}>
        {prefix}
        {text.replace(/\d/g, '?')}
      </SwapLayer>
    </LengthSlot>
  )
}

/**
 * Returns whether any player in a game has a recorded outcome. A game without one has nothing to
 * spoil, so its length is shown from the start and it gets no results toggle.
 */
function hasRecordedResults(game: ReadonlyDeep<GameRecordJson>): boolean {
  return Array.isArray(game.results) && game.results.some(([, r]) => r.result !== 'unknown')
}

const ToggleLabelSlot = styled.span`
  display: inline-grid;
  white-space: nowrap;
`

/**
 * Shows or hides a game's results. Both forms of its label occupy the same cell, so toggling doesn't
 * change the button's width.
 */
function ResultsToggle({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const showLabel = t('games.linkCard.showResults', 'Show results')
  const hideLabel = t('games.linkCard.hideResults', 'Hide results')
  return (
    <BackdropCardAction
      ariaLabel={revealed ? hideLabel : showLabel}
      ariaExpanded={revealed}
      onClick={onToggle}
      testName='game-link-card-results-toggle'>
      <MaterialIcon icon={revealed ? 'visibility_off' : 'visibility'} size={18} />
      <ToggleLabelSlot>
        <SwapLayer $visible={!revealed}>{showLabel}</SwapLayer>
        <SwapLayer $visible={revealed}>{hideLabel}</SwapLayer>
      </ToggleLabelSlot>
    </BackdropCardAction>
  )
}

type MatchupSize = 'medium' | 'large'

const MATCHUP_ROW_HEIGHT: Record<MatchupSize, number> = { medium: 20, large: 32 }
const MATCHUP_ROW_GAP = 8
/**
 * Rank icons sit a little smaller than a large row is tall, leaving the room to the player's name,
 * which is what's most often cut off.
 */
const DIVISION_ICON_SIZE: Record<MatchupSize, number> = { medium: 20, large: 28 }
/**
 * The most rows a matchup renders: a game holds at most 8 players, which a matchup lays out in two
 * columns. Only an uneven head-to-head (e.g. a 5v3 Top vs Bottom) has a side longer than this, and
 * that side collapses its overflow into a final "+N more" row (see {@link collapseMatchupSide}).
 */
const MAX_MATCHUP_ROWS = 4

/**
 * Splits a matchup side into the players it lists and how many more it summarizes in a final row,
 * so the side never renders more than {@link MAX_MATCHUP_ROWS} rows.
 */
export function collapseMatchupSide<T>(side: ReadonlyArray<T>): {
  shown: ReadonlyArray<T>
  hiddenCount: number
} {
  if (side.length <= MAX_MATCHUP_ROWS) {
    return { shown: side, hiddenCount: 0 }
  }
  const shown = side.slice(0, MAX_MATCHUP_ROWS - 1)
  return { shown, hiddenCount: side.length - shown.length }
}

/**
 * Returns a game's two sides when it's a head-to-head, or undefined otherwise. A head-to-head is any
 * game whose config splits into exactly two sides the way the server's own result and registration
 * logic splits it (see `getTeamsFromConfig`): two non-empty teams, or a lone team of two players.
 */
export function getVersusSides(
  game: ReadonlyDeep<GameRecordJson>,
): ReadonlyArray<ReadonlyArray<ReadonlyDeep<GameConfigPlayer>>> | undefined {
  const teams = getTeamsFromConfig(game.config as GameConfig)
  return teams?.length === 2 ? teams : undefined
}

function getPlayerCount(game: ReadonlyDeep<GameRecordJson>): number {
  return game.config.teams.reduce((count, team) => count + team.length, 0)
}

/** Returns the size a card's matchup renders at: large type is kept for a lone 1v1. */
function getMatchupSize(game: ReadonlyDeep<GameRecordJson>): MatchupSize {
  return getVersusSides(game) !== undefined && getPlayerCount(game) === 2 ? 'large' : 'medium'
}

/** Returns the height a game's matchup renders at. */
export function getMatchupHeight(game: ReadonlyDeep<GameRecordJson>, size: MatchupSize): number {
  const sides = getVersusSides(game)
  const rows = Math.min(
    MAX_MATCHUP_ROWS,
    sides
      ? Math.max(...sides.map(side => side.length))
      : Math.max(1, Math.ceil(getPlayerCount(game) / 2)),
  )
  return rows * MATCHUP_ROW_HEIGHT[size] + (rows - 1) * MATCHUP_ROW_GAP
}

const MAX_MATCHUP_HEIGHT =
  MAX_MATCHUP_ROWS * MATCHUP_ROW_HEIGHT.medium + (MAX_MATCHUP_ROWS - 1) * MATCHUP_ROW_GAP

const MatchupRoot = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
`

/** A roster's players, dealt alternately into two columns in name order. */
const RosterColumnsRoot = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 16px;
`

const MatchupSide = styled.div<{ $mirrored: boolean }>`
  min-width: 0;

  display: flex;
  flex-direction: column;
  align-items: ${props => (props.$mirrored ? 'flex-end' : 'flex-start')};
  gap: ${MATCHUP_ROW_GAP}px;
`

const MatchupPlayerRow = styled.div<{ $mirrored: boolean; $size: MatchupSize }>`
  max-width: 100%;
  height: ${props => MATCHUP_ROW_HEIGHT[props.$size]}px;

  display: flex;
  flex-direction: ${props => (props.$mirrored ? 'row-reverse' : 'row')};
  align-items: center;
  gap: ${props => (props.$size === 'large' ? 6 : 4)}px;
`

const MatchupResultMarker = styled(PlayerResultMarker)`
  && {
    margin-right: 0;
  }
`

const MatchupDivisionTooltip = styled(CardTooltip)`
  flex-shrink: 0;
`

const MatchupDivisionIcon = styled(DivisionIcon)<{ $size: MatchupSize }>`
  flex-shrink: 0;
  width: ${props => DIVISION_ICON_SIZE[props.$size]}px;
  height: ${props => DIVISION_ICON_SIZE[props.$size]}px;
`

const MatchupRaceIcon = styled(RaceIcon)<{ $size: MatchupSize }>`
  flex-shrink: 0;
  width: ${props => (props.$size === 'large' ? 24 : 20)}px;
  height: ${props => (props.$size === 'large' ? 24 : 20)}px;
`

const matchupNameStyles = css<{ $size: MatchupSize }>`
  ${props => (props.$size === 'large' ? titleMedium : titleSmall)};
  ${singleLine};
  min-width: 0;
`

const MatchupName = styled.span<{ $size: MatchupSize }>`
  ${matchupNameStyles};
`

const MatchupConnectedName = styled(ConnectedUsername)<{ $size: MatchupSize }>`
  ${matchupNameStyles};
`

const MatchupMoreLabel = styled.span`
  ${titleSmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const VersusLabel = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

/** The height of a "vs" with the game's length under it: two 16px lines. */
const VERSUS_STACK_HEIGHT = 32

/**
 * Returns whether a matchup at `size` has room for the game's length under its "vs" without growing
 * taller.
 */
function canShowLengthUnderVersus(game: ReadonlyDeep<GameRecordJson>, size: MatchupSize): boolean {
  return getVersusSides(game) !== undefined && getMatchupHeight(game, size) >= VERSUS_STACK_HEIGHT
}

/** The middle of a matchup: the "vs", with the game's length under it when shown there. */
const VersusStack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const VersusLength = styled(GameLength)`
  ${backdropTextShadow};
`

const GameCard = styled(BackdropCard)`
  & ${MatchupName}, & ${MatchupConnectedName}, & ${VersusLabel} {
    ${backdropTextShadow};
  }
`

/**
 * Returns a game's players split into the columns a matchup lays them out in: its two sides for a
 * head-to-head, or otherwise every player in name order, dealt alternately into two columns.
 */
export function getMatchupColumns(
  game: ReadonlyDeep<GameRecordJson>,
  getName: (player: ReadonlyDeep<GameConfigPlayer>) => string,
): ReadonlyArray<ReadonlyArray<ReadonlyDeep<GameConfigPlayer>>> {
  const sides = getVersusSides(game)
  if (sides) {
    return sides
  }

  const sorted = game.config.teams.flat().toSorted((a, b) => getName(a).localeCompare(getName(b)))
  return [sorted.filter((_, i) => i % 2 === 0), sorted.filter((_, i) => i % 2 === 1)]
}

/**
 * A game's players as two opposing sides mirrored around a "vs", each player's race and rank facing
 * the middle. Games that aren't a head-to-head lay their players out in two plain columns instead.
 */
function GameMatchup({
  game,
  divisionById,
  size,
  showResults,
  showLength,
}: {
  game: ReadonlyDeep<GameRecordJson>
  divisionById: ReadonlyMap<SbUserId, MatchmakingDivision> | undefined
  size: MatchupSize
  /**
   * Whether each player's outcome renders beside them. When false, a placeholder holds the place
   * of each outcome that would render.
   */
  showResults: boolean
  /**
   * Whether the game's length (masked until `showResults`) renders under the "vs". Only a
   * head-to-head has a "vs", and only one at least {@link VERSUS_STACK_HEIGHT} tall has room for it
   * (see {@link canShowLengthUnderVersus}).
   */
  showLength: boolean
}) {
  const { t } = useTranslation()
  const players = game.config.teams.flat()
  // Index-aligned with `players`, so the card rerenders only when one of its own players' names
  // changes.
  const names = useAppSelector(
    s => players.map(p => (p.isComputer ? undefined : s.users.byId.get(p.id)?.name)),
    shallowEqual,
  )
  const nameById = new Map(players.map((p, i) => [p.id, names[i]]))
  const getName = (player: ReadonlyDeep<GameConfigPlayer>) =>
    player.isComputer
      ? t('game.playerName.computer', 'Computer')
      : (nameById.get(player.id) ?? t('game.playerName.unknown', 'Unknown player'))
  const isVersus = getVersusSides(game) !== undefined
  const columns = getMatchupColumns(game, getName)

  const results = new Map<SbUserId, ReconciledPlayerResult>(
    Array.isArray(game.results) ? game.results : [],
  )

  const renderSide = (side: ReadonlyArray<ReadonlyDeep<GameConfigPlayer>>, mirrored: boolean) => {
    const { shown, hiddenCount } = collapseMatchupSide(side)
    return (
      <MatchupSide $mirrored={mirrored}>
        {shown.map((player, i) => {
          const division = player.isComputer ? undefined : divisionById?.get(player.id)
          const result = player.isComputer ? undefined : results.get(player.id)?.result
          return (
            // Keyed by position: every computer player in a game config shares the same id, so ids
            // aren't unique within a side.
            <MatchupPlayerRow key={i} $mirrored={mirrored} $size={size}>
              {result && result !== 'unknown' ? (
                <MatchupResultMarker result={result} concealed={!showResults} />
              ) : null}
              {division !== undefined ? (
                <MatchupDivisionTooltip
                  text={matchmakingDivisionToLabel(division, t)}
                  position='top'>
                  <MatchupDivisionIcon
                    division={division}
                    size={DIVISION_ICON_SIZE[size]}
                    $size={size}
                  />
                </MatchupDivisionTooltip>
              ) : null}
              <MatchupRaceIcon race={results.get(player.id)?.race ?? player.race} $size={size} />
              {player.isComputer ? (
                <MatchupName $size={size}>{getName(player)}</MatchupName>
              ) : (
                <CardClickBoundary>
                  <MatchupConnectedName
                    userId={player.id}
                    $size={size}
                    showTooltipForOverflow='top'
                  />
                </CardClickBoundary>
              )}
            </MatchupPlayerRow>
          )
        })}
        {hiddenCount > 0 ? (
          <MatchupPlayerRow $mirrored={mirrored} $size={size}>
            <MatchupMoreLabel>
              {t('games.linkCard.morePlayers', {
                defaultValue: '+{{count}} more',
                count: hiddenCount,
              })}
            </MatchupMoreLabel>
          </MatchupPlayerRow>
        ) : null}
      </MatchupSide>
    )
  }

  if (!isVersus) {
    return (
      <RosterColumnsRoot>
        {renderSide(columns[0], false)}
        {renderSide(columns[1], false)}
      </RosterColumnsRoot>
    )
  }

  return (
    <MatchupRoot>
      {renderSide(columns[0], true)}
      <VersusStack>
        <VersusLabel>{t('games.linkCard.versus', 'vs')}</VersusLabel>
        {showLength ? <VersusLength game={game} revealed={showResults} /> : null}
      </VersusStack>
      {renderSide(columns[1], false)}
    </MatchupRoot>
  )
}

/**
 * The card's header: the game's type (with its full label, e.g. "Ranked 1v1", in a tooltip when the
 * shown one leaves part of it out), its map, how long ago it was played (with the full start time in
 * a tooltip), its length when `showLength` is set, and the results toggle.
 */
function CardHeaderRow({
  game,
  mapName,
  showLength,
  resultsRevealed,
  onToggleResults,
}: {
  game: ReadonlyDeep<GameRecordJson>
  mapName: string
  showLength: boolean
  resultsRevealed: boolean
  onToggleResults: () => void
}) {
  const { t } = useTranslation()
  const typeLabel = getCardGameTypeLabel(game, t)
  const fullTypeLabel = getGameTypeLabel(game, t)
  return (
    <BackdropCardHeader>
      <BackdropCardTitle
        text={typeLabel}
        tooltip={fullTypeLabel !== typeLabel ? fullTypeLabel : undefined}
      />
      <BackdropCardMeta>
        {/* The map is hard to pick out from the blurred image behind the card. */}
        <BackdropCardMetaKeyText text={mapName} />
        <BackdropCardMetaText
          text={' · ' + narrowDuration.format(game.startTime)}
          tooltip={longTimestamp.format(game.startTime)}
        />
        {showLength ? <GameLength game={game} revealed={resultsRevealed} prefix=' · ' /> : null}
      </BackdropCardMeta>
      {hasRecordedResults(game) ? (
        <ResultsToggle revealed={resultsRevealed} onToggle={onToggleResults} />
      ) : null}
    </BackdropCardHeader>
  )
}

/**
 * The presentational part of {@link GameLinkCard}: renders the loading/error/notFound/loaded states
 * without fetching anything itself, so it can be driven directly (e.g. from a devonly test page).
 * It shows the game's type, map and start time over a blurred image of the map, and its players
 * with the ranks they had going into it, which give nothing away.
 *
 * The card hides the game's outcome and length until the viewer reveals them with its results
 * toggle: a link is often shared so that someone can go watch the game, and either would spoil it.
 * A game with no recorded outcome has nothing to spoil, so it shows its length from the start and
 * has no toggle. A reveal lasts only while the card stays mounted. Until then placeholders hold the
 * results' places, so revealing swaps them in without moving anything else on the card.
 *
 * The loading state renders a placeholder sized for the largest matchup, so the message it's
 * attached to never grows once the game arrives. The error state renders nothing: the inline link
 * in the message text still works, and shrinking away is safe (only growth breaks the message
 * list's autoscroll).
 */
export function GameLinkCardContent({
  state,
  onClick,
}: {
  state: GameLinkLoadState | undefined
  /** Opens the game's results page. */
  onClick: () => void
}) {
  const { t } = useTranslation()
  const [resultsRevealed, setResultsRevealed] = useState(false)

  if (!state) {
    return (
      <BackdropCardLoading $height={getBackdropCardHeight(MAX_MATCHUP_HEIGHT)} aria-hidden={true} />
    )
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'notFound') {
    return (
      <BackdropCardGone>
        {t('gameDetails.notFound', 'This game could not be found.')}
      </BackdropCardGone>
    )
  }

  const { game, map, divisionById } = state
  const size = getMatchupSize(game)
  const lengthUnderVersus = canShowLengthUnderVersus(game, size)
  const showResults = resultsRevealed || !hasRecordedResults(game)

  return (
    <GameCard
      imageUrl={map?.image512Url ?? map?.image256Url}
      height={getBackdropCardHeight(getMatchupHeight(game, size))}
      onClick={onClick}
      actionLabel={t('games.linkCard.view', 'View game')}
      testName='game-link-card-view-button'>
      <CardHeaderRow
        game={game}
        mapName={map?.name ?? t('game.mapName.unknown', 'Unknown map')}
        showLength={!lengthUnderVersus}
        resultsRevealed={showResults}
        onToggleResults={() => setResultsRevealed(!resultsRevealed)}
      />
      <GameMatchup
        game={game}
        divisionById={divisionById}
        size={size}
        showResults={showResults}
        showLength={lengthUnderVersus}
      />
    </GameCard>
  )
}

/**
 * A rich preview for a game results link posted in chat, the whole of which opens the game's results
 * page (on the tab the link points at). Fetches the game itself (see {@link useGameLinkState}), so
 * it can be rendered for any game id.
 */
export function GameLinkCard({ target }: { target: GameLinkTarget }) {
  const state = useGameLinkState(target.gameId)
  return (
    <GameLinkCardContent
      state={state}
      onClick={() => navigateToGameResults(target.gameId, false, target.subPage)}
    />
  )
}
