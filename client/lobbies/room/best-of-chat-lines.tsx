import { Trans, useTranslation } from 'react-i18next'
import { getBestOfSideName } from '../../../common/lobbies/lobby-best-of'
import { TransInterpolation } from '../../i18n/i18next'
import { SystemImportant } from '../../messaging/message-layout'
import {
  BestOfCorrectedMessage,
  BestOfEndedMessage,
  BestOfReopenedMessage,
  BestOfStartedMessage,
} from '../lobby-message-records'
import { bestOfFormatLabel, useBestOfSideLabel, useLobbyBestOf } from './best-of-parts'

/**
 * Labels the two sides of the series a chat line is about: by the names the sides have now, so the
 * line follows a rename, and otherwise by the members the line captured.
 */
function useChatLineSideLabels(
  bestOfId: string,
  sides: BestOfStartedMessage['sides'],
): [side1: string, side2: string] {
  const bestOf = useLobbyBestOf(bestOfId)
  const side1 = useBestOfSideLabel(sides[0], bestOf ? getBestOfSideName(bestOf, 0) : undefined)
  const side2 = useBestOfSideLabel(sides[1], bestOf ? getBestOfSideName(bestOf, 1) : undefined)
  return [side1, side2]
}

/** Announces a best-of series the host started, naming its format and who plays it. */
export function BestOfStartedLine({
  bestOfId,
  title,
  length,
  playAll,
  sides,
}: Omit<BestOfStartedMessage, 'id' | 'type' | 'time'>) {
  const { t } = useTranslation()
  const [side1, side2] = useChatLineSideLabels(bestOfId, sides)
  const seriesFormat = bestOfFormatLabel({ length, playAll }, t)

  return title ? (
    <Trans t={t} i18nKey='lobbies.room.chat.bestOfStartedFormatTitled'>
      Series started: <SystemImportant>{{ title } as TransInterpolation}</SystemImportant> ·{' '}
      {{ seriesFormat } as TransInterpolation} ·{' '}
      <SystemImportant>{{ side1 } as TransInterpolation}</SystemImportant> vs{' '}
      <SystemImportant>{{ side2 } as TransInterpolation}</SystemImportant>
    </Trans>
  ) : (
    <Trans t={t} i18nKey='lobbies.room.chat.bestOfStartedFormat'>
      Series started: {{ seriesFormat } as TransInterpolation} ·{' '}
      <SystemImportant>{{ side1 } as TransInterpolation}</SystemImportant> vs{' '}
      <SystemImportant>{{ side2 } as TransInterpolation}</SystemImportant>
    </Trans>
  )
}

/**
 * Announces how a best-of series ended: who won it and by how much, that it was drawn, or the score
 * it stopped at.
 */
export function BestOfEndedLine({
  bestOfId,
  sides,
  score,
  outcome,
}: Omit<BestOfEndedMessage, 'id' | 'type' | 'time'>) {
  const { t } = useTranslation()
  const [side1, side2] = useChatLineSideLabels(bestOfId, sides)

  if (outcome.kind === 'unfinished') {
    return t('lobbies.room.chat.bestOfEndedEarly', {
      defaultValue: 'The series was ended at {{score1}}–{{score2}}',
      score1: score[0],
      score2: score[1],
    })
  }
  if (outcome.kind === 'drawn') {
    return t('lobbies.room.chat.bestOfEndedDrawn', {
      defaultValue: 'The series ended in a draw, {{score1}}–{{score2}}',
      score1: score[0],
      score2: score[1],
    })
  }

  const winner = outcome.winner === 0 ? side1 : side2
  const winnerScore = score[outcome.winner]
  const loserScore = score[outcome.winner === 0 ? 1 : 0]
  return (
    <Trans t={t} i18nKey='lobbies.room.chat.bestOfWon'>
      <SystemImportant>{{ winner } as TransInterpolation}</SystemImportant> won the series{' '}
      {{ winnerScore }}–{{ loserScore }}
    </Trans>
  )
}

/** Announces a correction the host made to a best-of series' results or format. */
export function BestOfCorrectedLine({
  bestOfId,
  sides,
  correction,
}: Omit<BestOfCorrectedMessage, 'id' | 'type' | 'time'>) {
  const { t } = useTranslation()
  const [side1, side2] = useChatLineSideLabels(bestOfId, sides)

  switch (correction.kind) {
    case 'gameResult': {
      const { gameNumber, result } = correction
      if (result.status === 'notCounted') {
        return t('lobbies.room.chat.bestOfGameNotCounted', {
          defaultValue: 'Game {{gameNumber}} no longer counts',
          gameNumber,
        })
      }
      const side = result.winner === 0 ? side1 : side2
      return (
        <Trans t={t} i18nKey='lobbies.room.chat.bestOfGameWinnerSet'>
          Game {{ gameNumber }} now counts as a win for{' '}
          <SystemImportant>{{ side } as TransInterpolation}</SystemImportant>
        </Trans>
      )
    }
    case 'resultAdded': {
      const side = correction.winner === 0 ? side1 : side2
      return (
        <Trans t={t} i18nKey='lobbies.room.chat.bestOfResultAdded'>
          A win was added for <SystemImportant>{{ side } as TransInterpolation}</SystemImportant>
        </Trans>
      )
    }
    case 'resultRemoved': {
      const side = correction.winner === 0 ? side1 : side2
      return (
        <Trans t={t} i18nKey='lobbies.room.chat.bestOfResultRemoved'>
          An added win for <SystemImportant>{{ side } as TransInterpolation}</SystemImportant> was
          removed
        </Trans>
      )
    }
    case 'format':
      return correction.playAll
        ? t('lobbies.room.chat.bestOfFormatPlayAll', {
            defaultValue_one: 'The series is now {{count}} game, all played',
            defaultValue_other: 'The series is now {{count}} games, all played',
            count: correction.length,
          })
        : t('lobbies.room.chat.bestOfFormatBestOf', {
            defaultValue: 'The series is now a best of {{length}}',
            length: correction.length,
          })
    default:
      return correction satisfies never
  }
}

/** Announces that a correction left a decided best-of series undecided, so it runs again. */
export function BestOfReopenedLine({ score }: Omit<BestOfReopenedMessage, 'id' | 'type' | 'time'>) {
  const { t } = useTranslation()
  return t('lobbies.room.chat.bestOfReopened', {
    defaultValue: 'The series is open again at {{score1}}–{{score2}}',
    score1: score[0],
    score2: score[1],
  })
}
