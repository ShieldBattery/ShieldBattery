import { TFunction } from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { getGameDurationString } from '../../../common/games/games'
import {
  getResultLabel,
  getResultShortLabel,
  ReconciledResult,
} from '../../../common/games/results'
import {
  BestOfSideIndex,
  getBestOfGameNumber,
  getBestOfScore,
  getBestOfSideName,
  LobbyBestOfJson,
} from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { PlayerResultChip } from '../../games/result-chip'
import { MaterialIcon } from '../../icons/material/material-icon'
import { batchGetMapInfo } from '../../maps/action-creators'
import { IconButton } from '../../material/button'
import { EllipsizedText } from '../../material/ellipsized-text'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import {
  bodyMedium,
  bodySmall,
  headlineMedium,
  labelLarge,
  labelMedium,
  titleLarge,
  titleMedium,
} from '../../styles/typography'
import { RaceIcon } from '../race-icon'
import { bestOfFormatLabel, useBestOfSideLabel, useUserNames } from './best-of-parts'
import {
  getSeriesResultRows,
  getSeriesResultStrip,
  getSeriesRosters,
  SeriesMemberRecord,
  SeriesMemberResult,
  SeriesResultsPlayer,
  SeriesResultsRow,
} from './series-results-model'

/** Below this width the score card tightens up, and a member's results can wrap. */
const CARD_COMPACT_BELOW_PX = 440
/** Below this width the score card lists each member's results under their name. */
const ROSTER_STACKS_BELOW_PX = 560
/** The narrowest a result chip is. */
const CHIP_WIDTH_PX = 18
/** Below this width a game row gives up the spacer that keeps its centre cell on the page's axis. */
const GAME_ROW_COMPACT_BELOW_PX = 720

/** Which way a half of the sheet runs: side 1's half hugs the centre from the left, side 2's from the right. */
type Half = 'start' | 'end'

const halfOf = (side: BestOfSideIndex): Half => (side === 0 ? 'start' : 'end')

const Root = styled.div`
  container: series-results-sheet / inline-size;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const ScoreCard = styled.div`
  container: series-results-card / inline-size;
  padding: 20px 24px 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  background-color: var(--theme-container-low);

  @container series-results-sheet (width < ${CARD_COMPACT_BELOW_PX + 48}px) {
    padding: 16px;
  }
`

/** Stretches its lines and centres their text, so a title too long for the card ellipsizes. */
const CardHead = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;

  text-align: center;
`

const SeriesTitle = styled(EllipsizedText)`
  ${titleMedium};
`

const StateLine = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

/**
 * The two sides around the score, and each side's roster under its name. The score's column is the
 * page's centre axis, which the games below share.
 */
const Matchup = styled.div<{ $hasRosters: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-areas: ${props =>
    props.$hasRosters ? `'side1 score side2' 'roster1 . roster2'` : `'side1 score side2'`};
  align-items: center;
  column-gap: 24px;
  row-gap: 16px;

  @container series-results-card (width < ${CARD_COMPACT_BELOW_PX}px) {
    column-gap: 12px;
  }
`

/*
 * The parts of the card that hug the centre axis are capped at their grid area (`max-width: 100%`),
 * since an item aligned to one end is otherwise as wide as its unbroken text, however little room
 * its column has.
 */

const SideName = styled.div<{ $half: Half }>`
  grid-area: ${props => (props.$half === 'start' ? 'side1' : 'side2')};
  min-width: 0;

  display: flex;
  flex-direction: ${props => (props.$half === 'start' ? 'row' : 'row-reverse')};
  justify-content: flex-start;
  align-items: center;
  gap: 8px;

  justify-self: ${props => (props.$half === 'start' ? 'end' : 'start')};
  max-width: 100%;
`

const SideNameText = styled(EllipsizedText)`
  ${titleMedium};
  flex: 0 1 auto;
  min-width: 0;
`

const Score = styled.div`
  ${headlineMedium};
  grid-area: score;

  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  @container series-results-card (width < ${CARD_COMPACT_BELOW_PX}px) {
    ${titleLarge};
  }
`

/**
 * A side's people and their results. Names sit on the outer edge and the results toward the centre,
 * mirrored between the halves; in a narrow card each person's results go under their name.
 */
const Roster = styled.div<{ $half: Half }>`
  grid-area: ${props => (props.$half === 'start' ? 'roster1' : 'roster2')};
  align-self: start;
  min-width: 0;

  display: grid;
  grid-template-columns: ${props =>
    props.$half === 'start' ? 'minmax(0, 1fr) auto' : 'auto minmax(0, 1fr)'};
  align-items: center;
  column-gap: 12px;
  row-gap: 6px;

  @container series-results-card (width < ${ROSTER_STACKS_BELOW_PX}px) {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 8px;
  }
`

/** One person's row of a roster, which shares the roster's columns with the other rows. */
const MemberRow = styled.div`
  grid-column: 1 / -1;

  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  row-gap: 2px;
`

const MemberName = styled(EllipsizedText)<{ $half: Half }>`
  ${bodyMedium};
  grid-row: 1;
  grid-column: ${props => (props.$half === 'start' ? 1 : 2)};
  min-width: 0;
  max-width: 100%;
  justify-self: ${props => (props.$half === 'start' ? 'end' : 'start')};

  @container series-results-card (width < ${ROSTER_STACKS_BELOW_PX}px) {
    grid-column: 1;
  }
`

const MemberStrip = styled.div<{ $half: Half }>`
  grid-row: 1;
  grid-column: ${props => (props.$half === 'start' ? 2 : 1)};
  min-height: 20px;
  max-width: 100%;

  display: flex;
  align-items: center;
  gap: 4px;

  justify-self: ${props => (props.$half === 'start' ? 'start' : 'end')};

  @container series-results-card (width < ${ROSTER_STACKS_BELOW_PX}px) {
    grid-row: 2;
    grid-column: 1;
    justify-self: ${props => (props.$half === 'start' ? 'end' : 'start')};
  }

  /* Only the narrowest card is too narrow for a whole strip, which then wraps toward the centre. */
  @container series-results-card (width < ${CARD_COMPACT_BELOW_PX}px) {
    flex-wrap: wrap;
    justify-content: ${props => (props.$half === 'start' ? 'flex-end' : 'flex-start')};
    row-gap: 4px;
  }
`

const StripTally = styled.span`
  ${labelMedium};
  margin-inline-end: 2px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const StripNote = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/**
 * A result chip laid out by the gap of the row it sits in, rather than its own margin. It is wide
 * enough for the widest one-letter label, so a column of chips keeps the names beside it lined up.
 */
const ResultChip = styled(PlayerResultChip)`
  min-width: ${CHIP_WIDTH_PX}px;
  margin: 0;
`

const GamesSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const GamesHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const GameRows = styled.div`
  container: series-results-games / inline-size;

  display: flex;
  flex-direction: column;
`

const NoGames = styled.div`
  ${bodyMedium};
  padding-block: 12px;
  color: var(--theme-on-surface-variant);
`

/**
 * One entry of the series' results: side 1's players, the game itself in the centre, side 2's
 * players and the game's actions. A spacer as wide as the actions leads the row, so the centre cell
 * stays on the same axis as the score above.
 */
const GameRowRoot = styled.div`
  min-height: 56px;
  padding-block: 8px;

  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) minmax(128px, 176px) minmax(0, 1fr) 72px;
  grid-template-areas: '. side1 centre side2 actions';
  align-items: center;
  column-gap: 16px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }

  @container series-results-games (width < ${GAME_ROW_COMPACT_BELOW_PX}px) {
    grid-template-columns: minmax(0, 1fr) minmax(80px, 112px) minmax(0, 1fr) 32px;
    grid-template-areas: 'side1 centre side2 actions';
    column-gap: 8px;
  }
`

const dimmed = css`
  opacity: 0.56;
`

const GamePlayers = styled.div<{ $half: Half; $dimmed?: boolean }>`
  grid-area: ${props => (props.$half === 'start' ? 'side1' : 'side2')};
  min-width: 0;

  display: flex;
  flex-direction: column;
  align-items: ${props => (props.$half === 'start' ? 'flex-end' : 'flex-start')};
  gap: 4px;

  ${props => (props.$dimmed ? dimmed : '')}
`

const PlayerLine = styled.div<{ $half: Half }>`
  max-width: 100%;
  height: 20px;

  display: flex;
  flex-direction: ${props => (props.$half === 'start' ? 'row-reverse' : 'row')};
  align-items: center;
  gap: 6px;
`

const PlayerName = styled(EllipsizedText)`
  ${bodyMedium};
  flex: 0 1 auto;
  min-width: 0;
`

const ComputerName = styled.span`
  ${bodyMedium};
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--theme-on-surface-variant);
`

const PlayerRace = styled(RaceIcon)`
  width: 18px;
  height: 18px;
  flex-shrink: 0;
`

/** Holds a chip's place in a game that gave nobody a result, so names line up down the list. */
const ChipSpace = styled.span`
  width: ${CHIP_WIDTH_PX}px;
  flex-shrink: 0;
`

/** Holds a race icon's place for someone in a game with no record to say what they played. */
const RaceSpace = styled.span`
  width: 18px;
  flex-shrink: 0;
`

const GameCentre = styled.div<{ $dimmed?: boolean }>`
  grid-area: centre;
  min-width: 0;

  display: flex;
  flex-direction: column;
  align-items: center;

  text-align: center;

  ${props => (props.$dimmed ? dimmed : '')}
`

const GameNumber = styled.div`
  ${labelLarge};
  white-space: nowrap;
`

const GameMapName = styled(EllipsizedText)`
  ${bodyMedium};
  max-width: 100%;
`

const GameMeta = styled.div`
  ${bodySmall};
  max-width: 100%;

  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  column-gap: 4px;

  color: var(--theme-on-surface-variant);
`

const GameMetaPart = styled.span`
  white-space: nowrap;
`

const GameActions = styled.div`
  grid-area: actions;

  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;

  @container series-results-games (width < ${GAME_ROW_COMPACT_BELOW_PX}px) {
    flex-direction: column;
  }
`

const GameAction = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
  flex-shrink: 0;
`

const AddedResultSide = styled.div<{ $half: Half }>`
  grid-area: ${props => (props.$half === 'start' ? 'side1' : 'side2')};

  display: flex;
  justify-content: ${props => (props.$half === 'start' ? 'flex-end' : 'flex-start')};
`

/** A result chip, read out by its full label. */
function ResultMark({ result, testId }: { result: ReconciledResult; testId?: string }) {
  const { t } = useTranslation()
  return (
    <ResultChip
      $result={result}
      role='img'
      aria-label={getResultLabel(result, t)}
      data-testid={testId}>
      {getResultShortLabel(result, t)}
    </ResultChip>
  )
}

/** The line under the series' title: its format, then its next game or how it ended. */
function seriesStateLine(bestOf: LobbyBestOfJson, t: TFunction): string {
  let state: string
  switch (bestOf.outcome?.kind) {
    case undefined:
      state = t('lobbies.room.series.gameNumber', 'Game {{number}}', {
        number: getBestOfGameNumber(bestOf, bestOf.games.length),
      })
      break
    case 'won':
      state = t('lobbies.seriesSetup.resultsFinal', 'Final')
      break
    case 'drawn':
      state = t('lobbies.seriesSetup.resultsDrawn', 'Drawn')
      break
    case 'unfinished':
      state = t('lobbies.seriesSetup.resultsEndedEarly', 'Ended early')
      break
    default:
      state = bestOf.outcome satisfies never
  }
  return t('lobbies.room.results.stateLine', {
    defaultValue: '{{seriesFormat}} · {{state}}',
    seriesFormat: bestOfFormatLabel(bestOf, t),
    state,
  })
}

/** A side's chip beside its name once the series is decided: a win, a loss, or a draw for both. */
function sideOutcomeResult(
  bestOf: LobbyBestOfJson,
  side: BestOfSideIndex,
): ReconciledResult | undefined {
  switch (bestOf.outcome?.kind) {
    case 'won':
      return bestOf.outcome.winner === side ? 'win' : 'loss'
    case 'drawn':
      return 'draw'
    default:
      return undefined
  }
}

function SideHeading({ bestOf, side }: { bestOf: LobbyBestOfJson; side: BestOfSideIndex }) {
  const label = useBestOfSideLabel(bestOf.sides[side], getBestOfSideName(bestOf, side))
  const result = sideOutcomeResult(bestOf, side)
  return (
    <SideName $half={halfOf(side)} data-testid={`series-results-side-${side + 1}`}>
      <SideNameText text={label} />
      {result ? (
        <ResultMark result={result} testId={`series-results-side-${side + 1}-result`} />
      ) : null}
    </SideName>
  )
}

function MemberResults({
  record,
  half,
  testId,
}: {
  record: SeriesMemberRecord
  half: Half
  testId: string
}) {
  const { t } = useTranslation()
  if (!record.gamesPlayed) {
    return (
      <MemberStrip $half={half} data-testid={testId}>
        <StripNote>{t('lobbies.room.results.notPlayedYet', 'Not played yet')}</StripNote>
      </MemberStrip>
    )
  }
  if (!record.results.length) {
    return (
      <MemberStrip $half={half} data-testid={testId}>
        <StripNote>{t('lobbies.room.results.noCountedGames', 'No games counted')}</StripNote>
      </MemberStrip>
    )
  }

  const strip = getSeriesResultStrip(record.results)
  const chips = (results: ReadonlyArray<SeriesMemberResult>) =>
    results.map((result, i) => <ResultMark key={i} result={result} />)
  return (
    <MemberStrip $half={half} data-testid={testId}>
      {strip.kind === 'all' ? (
        chips(strip.results)
      ) : (
        <>
          <StripTally>
            {t('lobbies.room.results.tally', {
              defaultValue: '{{wins}}-{{losses}}',
              wins: strip.wins,
              losses: strip.losses,
            })}
          </StripTally>
          {chips(strip.recent)}
        </>
      )}
    </MemberStrip>
  )
}

function SideRoster({
  roster,
  side,
  names,
}: {
  roster: ReadonlyArray<SeriesMemberRecord>
  side: BestOfSideIndex
  names: ReadonlyMap<SbUserId, string>
}) {
  const half = halfOf(side)
  return (
    <Roster $half={half} data-testid={`series-results-roster-${side + 1}`}>
      {roster.map(record => {
        const testId = `series-results-member-${side + 1}-${record.userId}`
        return (
          <MemberRow key={record.userId}>
            <MemberName $half={half} text={names.get(record.userId) ?? '…'} />
            <MemberResults record={record} half={half} testId={testId} />
          </MemberRow>
        )
      })}
    </Roster>
  )
}

function GamePlayerLine({
  player,
  half,
  result,
  names,
}: {
  player: SeriesResultsPlayer
  half: Half
  result: ReconciledResult | undefined
  names: ReadonlyMap<SbUserId, string>
}) {
  const { t } = useTranslation()
  return (
    <PlayerLine $half={half}>
      {result ? <ResultMark result={result} /> : <ChipSpace />}
      {player.race ? <PlayerRace race={player.race} /> : <RaceSpace />}
      {player.kind === 'human' ? (
        <PlayerName text={names.get(player.userId) ?? '…'} />
      ) : (
        <ComputerName>{t('game.playerName.computer', 'Computer')}</ComputerName>
      )}
    </PlayerLine>
  )
}

function GameRow({
  row,
  names,
  onWatchReplay,
  onViewGameSummary,
}: {
  row: Extract<SeriesResultsRow, { kind: 'game' }>
  names: ReadonlyMap<SbUserId, string>
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { mapId } = row
  const mapName = useAppSelector(s => (mapId ? s.maps.byId.get(mapId)?.name : undefined))

  // A series' earlier games can be on maps nothing else on the page has any reason to have loaded.
  useEffect(() => {
    if (mapId) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  const { status } = row
  const isNotCounted = status.kind === 'notCounted'
  const meta: string[] = []
  if (row.durationMs !== undefined) {
    meta.push(getGameDurationString(row.durationMs))
  }
  switch (status.kind) {
    case 'won':
      if (status.setByHost) {
        meta.push(t('lobbies.room.bestOf.setByHost', 'Set by host'))
      }
      break
    case 'notCounted':
      meta.push(t('lobbies.room.bestOf.notCounted', 'Not counted'))
      break
    case 'waiting':
      meta.push(t('lobbies.room.series.waitingForResults', 'Waiting for results'))
      break
    case 'playing':
      meta.push(t('lobbies.room.series.playing', 'Playing'))
      break
    default:
      status satisfies never
  }

  return (
    <GameRowRoot data-testid={`series-results-game-${row.gameId}`}>
      {([0, 1] as const).map(side => {
        const half = halfOf(side)
        let result: ReconciledResult | undefined
        if (status.kind === 'won') {
          result = status.winner === side ? 'win' : 'loss'
        }
        return (
          <GamePlayers key={side} $half={half} $dimmed={isNotCounted}>
            {row.players[side].map((player, i) => (
              <GamePlayerLine
                key={player.kind === 'human' ? player.userId : `computer-${i}`}
                player={player}
                half={half}
                result={result}
                names={names}
              />
            ))}
          </GamePlayers>
        )
      })}
      <GameCentre $dimmed={isNotCounted}>
        <GameNumber>
          {t('lobbies.room.series.gameNumber', 'Game {{number}}', { number: row.gameNumber })}
        </GameNumber>
        {row.hasRecord ? (
          <GameMapName text={mapName ?? t('lobbies.room.series.unknownMap', 'unknown map')} />
        ) : null}
        {meta.length ? (
          <GameMeta>
            {meta.map((part, i) => (
              <GameMetaPart key={i}>{i < meta.length - 1 ? `${part} ·` : part}</GameMetaPart>
            ))}
          </GameMeta>
        ) : null}
      </GameCentre>
      {row.hasRecord ? (
        <GameActions>
          <Tooltip text={t('lobbies.room.series.watchReplay', 'Watch replay')} tabIndex={-1}>
            <GameAction
              icon={<MaterialIcon icon='play_arrow' />}
              ariaLabel={t('lobbies.room.series.watchReplay', 'Watch replay')}
              onClick={() => onWatchReplay(row.gameId)}
              testName={`series-results-replay-${row.gameId}`}
            />
          </Tooltip>
          <Tooltip text={t('lobbies.room.series.fullSummary', 'Full summary')} tabIndex={-1}>
            <GameAction
              icon={<MaterialIcon icon='summarize' />}
              ariaLabel={t('lobbies.room.series.fullSummary', 'Full summary')}
              onClick={() => onViewGameSummary(row.gameId)}
              testName={`series-results-summary-${row.gameId}`}
            />
          </Tooltip>
        </GameActions>
      ) : null}
    </GameRowRoot>
  )
}

function AddedResultRow({ row }: { row: Extract<SeriesResultsRow, { kind: 'addedResult' }> }) {
  const { t } = useTranslation()
  return (
    <GameRowRoot data-testid={`series-results-added-${row.resultId}`}>
      {([0, 1] as const).map(side => (
        <AddedResultSide key={side} $half={halfOf(side)}>
          <ResultMark result={row.winner === side ? 'win' : 'loss'} />
        </AddedResultSide>
      ))}
      <GameCentre>
        <GameNumber>
          {t('lobbies.room.series.gameNumber', 'Game {{number}}', { number: row.gameNumber })}
        </GameNumber>
        <GameMeta>
          <GameMetaPart>{t('lobbies.room.bestOf.addedByHost', 'Added by host')}</GameMetaPart>
        </GameMeta>
      </GameCentre>
    </GameRowRoot>
  )
}

export interface SeriesResultsProps {
  bestOf: LobbyBestOfJson
  /** Finished games, which the series' games are looked up in for their maps, lengths and races. */
  games: ReadonlyArray<LobbySeriesGameJson>
  /** The game being played right now, if any. */
  playingGameId?: string
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}

/**
 * A best-of series' results as a mirrored match sheet, side 1 on the left and side 2 on the right
 * all the way down: a score card with each side's people and how the games they played went, then
 * every game of the series in order, with who played it for each side around the game itself.
 *
 * Everything shown comes from the series and the games given, so it reads the same wherever the
 * series is shown.
 */
export function SeriesResults({
  bestOf,
  games,
  playingGameId,
  onWatchReplay,
  onViewGameSummary,
}: SeriesResultsProps) {
  const { t } = useTranslation()
  const [score1, score2] = getBestOfScore(bestOf)
  const rosters = getSeriesRosters(bestOf)
  const rows = getSeriesResultRows(bestOf, games, playingGameId)
  // A side of one has nothing to list beyond its name.
  const showRosters = [rosters[0].length > 1, rosters[1].length > 1]

  const userIds = Array.from(
    new Set([
      ...rosters.flat().map(record => record.userId),
      ...rows.flatMap(row =>
        row.kind === 'game'
          ? row.players.flat().flatMap(player => (player.kind === 'human' ? [player.userId] : []))
          : [],
      ),
    ]),
  )
  const userNames = useUserNames(userIds)
  const names = new Map(userIds.map((userId, i) => [userId, userNames[i]]))

  return (
    <Root data-testid='series-results'>
      <ScoreCard>
        <CardHead>
          <SeriesTitle text={bestOf.title ?? t('lobbies.seriesSetup.title', 'Series')} />
          <StateLine data-testid='series-results-state'>{seriesStateLine(bestOf, t)}</StateLine>
        </CardHead>
        <Matchup $hasRosters={showRosters[0] || showRosters[1]}>
          <SideHeading bestOf={bestOf} side={0} />
          <Score data-testid='series-results-score'>
            {t('lobbies.room.bestOf.score', {
              defaultValue: '{{score1}} – {{score2}}',
              score1,
              score2,
            })}
          </Score>
          <SideHeading bestOf={bestOf} side={1} />
          {([0, 1] as const).map(side =>
            showRosters[side] ? (
              <SideRoster key={side} roster={rosters[side]} side={side} names={names} />
            ) : null,
          )}
        </Matchup>
      </ScoreCard>

      <GamesSection>
        <GamesHeader>{t('lobbies.room.series.gamesLabel', 'Games')}</GamesHeader>
        <GameRows>
          {rows.length ? (
            rows.map(row =>
              row.kind === 'game' ? (
                <GameRow
                  key={row.key}
                  row={row}
                  names={names}
                  onWatchReplay={onWatchReplay}
                  onViewGameSummary={onViewGameSummary}
                />
              ) : (
                <AddedResultRow key={row.key} row={row} />
              ),
            )
          ) : (
            <NoGames>{t('lobbies.room.results.noGames', 'No games played yet')}</NoGames>
          )}
        </GameRows>
      </GamesSection>
    </Root>
  )
}
