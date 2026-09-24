import { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameConfigPlayer, GameSource } from '../../common/games/configuration'
import { GameType } from '../../common/games/game-type'
import {
  GameRecordJson,
  getGameDurationString,
  GetGameResponse,
  getGameTypeLabel,
} from '../../common/games/games'
import { ReconciledPlayerResult } from '../../common/games/results'
import { MapInfoJson } from '../../common/maps'
import {
  getDivisionBeforeRatingChange,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { dispatch as globalDispatch } from '../dispatch-registry'
import { useOverflowingElement } from '../dom/overflowing-element'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { DivisionIcon } from '../matchmaking/rank-icon'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import {
  INLINE_CARD_BORDER_WIDTH,
  InlineCardGone,
  InlineCardLoading,
  inlineCardShell,
} from '../messaging/inline-card'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { useAppSelector } from '../redux-hooks'
import {
  bodySmall,
  labelLarge,
  labelMedium,
  singleLine,
  titleMedium,
  titleSmall,
} from '../styles/typography'
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
type GameLinkLoadState =
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

/**
 * A tooltip for a card's content. Its trigger isn't a tab stop: card content is plain text and
 * images already exposed to assistive technology, and a chat full of cards would otherwise bury the
 * message list under tab stops.
 */
function CardTooltip(props: Omit<React.ComponentProps<typeof Tooltip>, 'tabIndex'>) {
  return <Tooltip {...props} tabIndex={-1} />
}

const TooltipTextSpan = styled.span`
  ${singleLine};
  /* Keeps the spaces around separators that texts start with, which would otherwise collapse. */
  white-space: pre;
`

/**
 * A single line of text that ellipsizes when it doesn't fit, with a tooltip holding `tooltip` (shown
 * always) or else the full text (shown only while it's cut off).
 */
function TooltipText({
  text,
  tooltip,
  className,
}: {
  text: string
  tooltip?: string
  className?: string
}) {
  const [ref, isOverflowing] = useOverflowingElement<HTMLSpanElement>()
  return (
    <CardTooltip
      className={className}
      text={tooltip ?? text}
      disabled={tooltip === undefined && !isOverflowing}>
      <TooltipTextSpan ref={ref}>{text}</TooltipTextSpan>
    </CardTooltip>
  )
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
 * Returns whether a game has anything a results reveal would show: a reported outcome for some
 * player, or the game's length.
 */
function hasRevealableResults(game: ReadonlyDeep<GameRecordJson>): boolean {
  return (
    !!game.gameLength ||
    (Array.isArray(game.results) && game.results.some(([, r]) => r.result !== 'unknown'))
  )
}

const ToggleLabelSlot = styled.span`
  display: inline-grid;
  white-space: nowrap;
`

const ResultsToggleButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  flex-shrink: 0;
  align-self: center;
  height: 24px;
  padding: 0 4px;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 4px;
  color: var(--theme-on-surface-variant);
  cursor: pointer;
  transition: color 150ms linear;

  &:hover {
    color: var(--theme-on-surface);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
  }
`

/**
 * Shows or hides a game's results. Both forms of its label occupy the same cell, so toggling doesn't
 * change the button's width. Renders nothing for a game with no results to show.
 */
function ResultsToggle({
  game,
  revealed,
  onToggle,
}: {
  game: ReadonlyDeep<GameRecordJson>
  revealed: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  if (!hasRevealableResults(game)) {
    return null
  }

  const showLabel = t('games.linkCard.showResults', 'Show results')
  const hideLabel = t('games.linkCard.hideResults', 'Hide results')
  return (
    <ResultsToggleButton
      type='button'
      aria-label={revealed ? hideLabel : showLabel}
      onClick={event => {
        // Toggling the results doesn't also open the game.
        event.stopPropagation()
        onToggle()
      }}
      data-testid='game-link-card-results-toggle'>
      <MaterialIcon icon={revealed ? 'visibility_off' : 'visibility'} size={18} />
      <ToggleLabelSlot>
        <SwapLayer $visible={!revealed}>{showLabel}</SwapLayer>
        <SwapLayer $visible={revealed}>{hideLabel}</SwapLayer>
      </ToggleLabelSlot>
    </ResultsToggleButton>
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
 * columns.
 */
const MAX_MATCHUP_ROWS = 4

/**
 * Returns a game's two sides when it's a head-to-head (two teams facing each other, or exactly two
 * players), or undefined for games whose players can't honestly be split into two opposing sides.
 */
function getVersusSides(
  game: ReadonlyDeep<GameRecordJson>,
): ReadonlyArray<ReadonlyArray<ReadonlyDeep<GameConfigPlayer>>> | undefined {
  const { gameType, teams } = game.config
  if (gameType === GameType.TopVsBottom && teams.length === 2) {
    return teams
  }
  const players = teams.flat()
  return players.length === 2 ? [[players[0]], [players[1]]] : undefined
}

function getPlayerCount(game: ReadonlyDeep<GameRecordJson>): number {
  return game.config.teams.reduce((count, team) => count + team.length, 0)
}

/** Returns the size a card's matchup renders at: large type is kept for a lone 1v1. */
function getMatchupSize(game: ReadonlyDeep<GameRecordJson>): MatchupSize {
  return getVersusSides(game) !== undefined && getPlayerCount(game) === 2 ? 'large' : 'medium'
}

/** Returns the height a game's matchup renders at. */
function getMatchupHeight(game: ReadonlyDeep<GameRecordJson>, size: MatchupSize): number {
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

/**
 * Keeps clicks inside it from reaching the card, whose whole surface opens the game, for content
 * that handles clicks itself. React events bubble through portals along the component tree, so this
 * also covers the menus and overlays such content opens.
 */
const CardClickBoundary = styled.span`
  display: contents;
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
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
`

/**
 * Returns a game's players split into the columns a matchup lays them out in: its two sides for a
 * head-to-head, or otherwise every player in name order, dealt alternately into two columns.
 */
function getMatchupColumns(
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
  const usersById = useAppSelector(s => s.users.byId)
  const getName = (player: ReadonlyDeep<GameConfigPlayer>) =>
    player.isComputer
      ? t('game.playerName.computer', 'Computer')
      : (usersById.get(player.id)?.name ?? t('game.playerName.unknown', 'Unknown player'))
  const isVersus = getVersusSides(game) !== undefined
  const columns = getMatchupColumns(game, getName)

  const results = new Map<SbUserId, ReconciledPlayerResult>(
    Array.isArray(game.results) ? game.results : [],
  )

  const renderSide = (side: ReadonlyArray<ReadonlyDeep<GameConfigPlayer>>, mirrored: boolean) => (
    <MatchupSide $mirrored={mirrored}>
      {side.map(player => {
        const division = player.isComputer ? undefined : divisionById?.get(player.id)
        const result = player.isComputer ? undefined : results.get(player.id)?.result
        return (
          <MatchupPlayerRow key={player.id} $mirrored={mirrored} $size={size}>
            {result && result !== 'unknown' ? (
              <MatchupResultMarker result={result} concealed={!showResults} />
            ) : null}
            {division !== undefined ? (
              <MatchupDivisionTooltip text={matchmakingDivisionToLabel(division, t)} position='top'>
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
              <CardClickBoundary onClick={event => event.stopPropagation()}>
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
    </MatchupSide>
  )

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

const HEADER_ROW_HEIGHT = 20

const CardHeader = styled.div`
  height: ${HEADER_ROW_HEIGHT}px;
  min-width: 0;
  flex-shrink: 0;

  display: flex;
  align-items: baseline;
  gap: 8px;
`

const GameTypeText = styled(TooltipText)`
  ${titleSmall};
  flex-shrink: 0;
  color: var(--theme-on-surface);
`

/** Holds the header's meta text: the map, start time and (sometimes) length. */
const HeaderMeta = styled.div`
  ${bodySmall};
  min-width: 0;
  flex-grow: 1;

  display: flex;
  align-items: baseline;

  color: var(--theme-on-surface-variant);
`

/**
 * The map's name in the header: it gives up its width only once everything after it (the date) has
 * none left to give, since the map is hard to pick out from the blurred image behind the card.
 */
const HeaderMapName = styled(TooltipText)`
  flex-shrink: 0;
  max-width: 100%;
`

const HeaderDate = styled(TooltipText)`
  min-width: 0;
`

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
    <CardHeader>
      <GameTypeText
        text={typeLabel}
        tooltip={fullTypeLabel !== typeLabel ? fullTypeLabel : undefined}
      />
      <HeaderMeta>
        <HeaderMapName text={mapName} />
        <HeaderDate
          text={' · ' + narrowDuration.format(game.startTime)}
          tooltip={longTimestamp.format(game.startTime)}
        />
        {showLength ? <GameLength game={game} revealed={resultsRevealed} prefix=' · ' /> : null}
      </HeaderMeta>
      <ResultsToggle game={game} revealed={resultsRevealed} onToggle={onToggleResults} />
    </CardHeader>
  )
}

const CARD_PADDING_Y = 12
const CARD_PADDING_X = 16
const CARD_GAP = 16
/**
 * Wider than the other inline cards: a head-to-head splits the card between two sides, each of which
 * needs room for a full player name beside its icons. The card still shrinks to fit narrower chats.
 */
const CARD_WIDTH = 500

const cardWidth = css`
  width: ${CARD_WIDTH}px;
`

const CardLoading = styled(InlineCardLoading)`
  ${cardWidth};
`

const CardGone = styled(InlineCardGone)`
  ${cardWidth};
`

function getCardHeight(matchupHeight: number): number {
  return (
    INLINE_CARD_BORDER_WIDTH * 2 + CARD_PADDING_Y * 2 + HEADER_ROW_HEIGHT + CARD_GAP + matchupHeight
  )
}

const BackdropImage = styled.img`
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;

  object-fit: cover;
  filter: saturate(0.9) blur(1px);
  /* Slightly oversized at rest so the blur never pulls the card's background in at the edges. */
  transform: scale(1.03);
  transition: transform 600ms cubic-bezier(0.2, 0, 0, 1);

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

const BackdropScrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: -1;

  /* Darkest behind the header line, easing off behind the matchup so the map reads through. */
  background: linear-gradient(
    180deg,
    rgb(from var(--theme-container-low) r g b / 0.9) 0%,
    rgb(from var(--theme-container-low) r g b / 0.52) 50%,
    rgb(from var(--theme-container-low) r g b / 0.62) 100%
  );
  transition: opacity 300ms linear;
`

const CardRoot = styled.div<{ $height: number }>`
  ${inlineCardShell};
  ${cardWidth};
  position: relative;
  height: ${props => props.$height}px;
  padding: ${CARD_PADDING_Y}px ${CARD_PADDING_X}px;
  overflow: hidden;
  isolation: isolate;

  display: flex;
  flex-direction: column;
  gap: ${CARD_GAP}px;

  background-color: var(--theme-container-low);
  border: ${INLINE_CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
  cursor: pointer;

  & ${MatchupName}, & ${MatchupConnectedName}, & ${VersusLabel} {
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.7);
  }

  &:hover ${BackdropImage} {
    transform: scale(1.07);
  }

  &:hover ${BackdropScrim} {
    opacity: 0.9;
  }
`

/**
 * The card's keyboard and assistive-technology entry point: a transparent button stretched over the
 * card that pointer events pass straight through, so the card's content stays hoverable. It has no
 * click handler of its own; activating it dispatches a click that bubbles to the card's, which does
 * the opening.
 */
const CardLinkButton = styled.button`
  position: absolute;
  inset: 0;
  z-index: 1;
  margin: 0;
  padding: 0;

  background: transparent;
  border: none;
  border-radius: inherit;
  pointer-events: none;

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: -2px;
  }
`

/**
 * A rich preview for a game results link posted in chat, the whole of which opens the game's results
 * page (on the tab the link points at). It shows the game's type, map and start time over a blurred
 * image of the map, and its players with the ranks they had going into it, which give nothing away.
 *
 * The card hides the game's outcome and length until the viewer reveals them with its results
 * toggle: a link is often shared so that someone can go watch the game, and either would spoil it.
 * A reveal lasts only while the card stays mounted. Until then placeholders hold the results'
 * places, so revealing swaps them in without moving anything else on the card.
 *
 * The loading state renders a placeholder sized for the largest matchup, so the message it's
 * attached to never grows once the game arrives. The error state renders nothing: the inline link
 * in the message text still works, and shrinking away is safe (only growth breaks the message
 * list's autoscroll).
 */
export function GameLinkCard({ target }: { target: GameLinkTarget }) {
  const { t } = useTranslation()
  const state = useGameLinkState(target.gameId)
  const [resultsRevealed, setResultsRevealed] = useState(false)

  if (!state) {
    return <CardLoading $height={getCardHeight(MAX_MATCHUP_HEIGHT)} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'notFound') {
    return <CardGone>{t('gameDetails.notFound', 'This game could not be found.')}</CardGone>
  }

  const { game, map, divisionById } = state
  const size = getMatchupSize(game)
  const lengthUnderVersus = canShowLengthUnderVersus(game, size)
  const imageUrl = map?.image512Url ?? map?.image256Url

  return (
    <CardRoot
      $height={getCardHeight(getMatchupHeight(game, size))}
      onClick={() => {
        // The click that ends a text selection is ignored, so the card's text can still be selected
        // and copied.
        if (window.getSelection()?.isCollapsed !== false) {
          navigateToGameResults(target.gameId, false, target.subPage)
        }
      }}>
      {imageUrl ? <BackdropImage src={imageUrl} alt='' draggable={false} /> : null}
      <BackdropScrim />
      <CardHeaderRow
        game={game}
        mapName={map?.name ?? t('game.mapName.unknown', 'Unknown map')}
        showLength={!lengthUnderVersus}
        resultsRevealed={resultsRevealed}
        onToggleResults={() => setResultsRevealed(!resultsRevealed)}
      />
      <GameMatchup
        game={game}
        divisionById={divisionById}
        size={size}
        showResults={resultsRevealed}
        showLength={lengthUnderVersus}
      />
      <CardLinkButton
        type='button'
        aria-label={t('games.linkCard.view', 'View game')}
        data-testid='game-link-card-view-button'
      />
    </CardRoot>
  )
}
