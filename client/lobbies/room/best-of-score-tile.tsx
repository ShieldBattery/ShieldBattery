import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BestOfSideIndex,
  getBestOfScore,
  getBestOfSeatedSides,
  getBestOfSideName,
  LobbyBestOfJson,
} from '../../../common/lobbies/lobby-best-of'
import { SbUserId } from '../../../common/users/sb-user-id'
import { MaterialIcon } from '../../icons/material/material-icon'
import { EllipsizedText } from '../../material/ellipsized-text'
import { Tooltip } from '../../material/tooltip'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, labelSmall, singleLine, titleMedium } from '../../styles/typography'
import { useUserNames } from './best-of-parts'

/**
 * The best-of series' score at the start of the timeline, in the same frame as the game tiles but
 * not a button itself: it opens nothing.
 */
const ScoreTile = styled.div`
  flex: 0 1 208px;
  min-width: 160px;
  padding: 8px 12px;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;

  border-radius: 8px;
  background-color: rgb(from var(--theme-container-low) r g b / 0.7);
  backdrop-filter: blur(4px);
  outline: 1px solid rgb(from var(--theme-on-surface) r g b / 0.08);
`

const ScoreRow = styled.div<{ $winner: boolean }>`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  color: ${props => (props.$winner ? 'var(--theme-amber)' : 'inherit')};
`

/** The side's label: its first player's name, which ellipsizes, then the count of the others. */
const ScoreSideLabel = styled(Tooltip)`
  flex: 1 1 auto;
  min-width: 0;
`

const ScoreSideContent = styled.div`
  ${bodyMedium};
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 4px;
`

const ScoreSideName = styled.span`
  ${singleLine};
  min-width: 0;
`

const ScoreSideMore = styled.span`
  flex-shrink: 0;
  white-space: nowrap;
`

/** A named side's label: its name above the line naming who of it is seated to play. */
const ScoreSideNamed = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const ScoreSideTitle = styled(EllipsizedText)`
  ${bodyMedium};
`

/**
 * Who of a named side sits in a player seat for the next game. It keeps its line's height while it
 * names nobody, so the tile doesn't change height as people sit down and stand up.
 */
const ScoreSeatedLine = styled.div`
  ${labelSmall};
  min-height: 16px;
  min-width: 0;
  color: var(--theme-on-surface-variant);
`

const ScoreValue = styled.span`
  ${titleMedium};
  flex-shrink: 0;
  min-width: 2ch;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
`

/**
 * One side's row in the score tile: who it is, and how many games it has won. A named side reads by
 * its name, with a line under it naming those of its members seated to play the next game (given as
 * `seated`; absent once the series is over); an unnamed side reads by its first member and how many
 * others it has.
 */
function BestOfScoreRow({
  side,
  sideIndex,
  name,
  seated,
  score,
  isWinner,
}: {
  side: ReadonlyArray<SbUserId>
  sideIndex: BestOfSideIndex
  name: string | undefined
  seated: ReadonlyArray<SbUserId> | undefined
  score: number
  isWinner: boolean
}) {
  const { t } = useTranslation()
  // The seated members are always some of the side's, whose names this loads anyway.
  const names = useUserNames(side)
  const testId = `best-of-score-row-${sideIndex + 1}`

  if (name !== undefined) {
    const seatedNames = seated
      ? side.flatMap((userId, i) => (seated.includes(userId) ? [names[i]] : []))
      : undefined
    return (
      <ScoreRow $winner={isWinner} data-testid={testId}>
        {isWinner ? <MaterialIcon icon='trophy' size={14} filled /> : null}
        <ScoreSideNamed>
          <ScoreSideTitle text={name} />
          {seatedNames ? (
            <ScoreSeatedLine data-testid={`best-of-score-seated-${sideIndex + 1}`}>
              {seatedNames.length ? <EllipsizedText text={seatedNames.join(', ')} /> : null}
            </ScoreSeatedLine>
          ) : null}
        </ScoreSideNamed>
        <ScoreValue>{score}</ScoreValue>
      </ScoreRow>
    )
  }

  return (
    <ScoreRow $winner={isWinner} data-testid={testId}>
      {isWinner ? <MaterialIcon icon='trophy' size={14} filled /> : null}
      <ScoreSideLabel text={names.join(', ')} tabIndex={-1}>
        <ScoreSideContent>
          <ScoreSideName>{names[0] ?? '…'}</ScoreSideName>
          {names.length > 1 ? (
            <ScoreSideMore>
              {t('lobbies.room.bestOf.sideMore', {
                defaultValue: '+{{extra}}',
                extra: names.length - 1,
              })}
            </ScoreSideMore>
          ) : null}
        </ScoreSideContent>
      </ScoreSideLabel>
      <ScoreValue>{score}</ScoreValue>
    </ScoreRow>
  )
}

/**
 * The timeline's leading tile while it shows a best-of series: a row per side with the games it
 * has won. The side that won the series is marked the way the standings mark their leader.
 */
export function BestOfScoreTile({ bestOf }: { bestOf: LobbyBestOfJson }) {
  const lobby = useAppSelector(s => s.lobby.info)
  const score = getBestOfScore(bestOf)
  const winner = bestOf.outcome?.kind === 'won' ? bestOf.outcome.winner : undefined
  // Only a running series has a next game for anyone to be seated for.
  const seatedSides = bestOf.outcome ? undefined : getBestOfSeatedSides(lobby, bestOf.sides)

  return (
    <ScoreTile data-testid='best-of-score-tile'>
      {([0, 1] as const).map(sideIndex => (
        <BestOfScoreRow
          key={sideIndex}
          side={bestOf.sides[sideIndex]}
          sideIndex={sideIndex}
          name={getBestOfSideName(bestOf, sideIndex)}
          seated={seatedSides?.[sideIndex]}
          score={score[sideIndex]}
          isWinner={winner === sideIndex}
        />
      ))}
    </ScoreTile>
  )
}
