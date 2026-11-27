import { Trans, useTranslation } from 'react-i18next'
import { getBestOfSideName } from '../../../common/lobbies/lobby-best-of'
import { TransInterpolation } from '../../i18n/i18next'
import { SystemImportant } from '../../messaging/message-layout'
import { BestOfEndedMessage, BestOfStartedMessage } from '../lobby-message-records'
import { useBestOfSideLabel, useLobbyBestOf } from './best-of-parts'

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

/** Announces a best-of series the host started, naming who plays it. */
export function BestOfStartedLine({
  bestOfId,
  title,
  length,
  sides,
}: Omit<BestOfStartedMessage, 'id' | 'type' | 'time'>) {
  const { t } = useTranslation()
  const [side1, side2] = useChatLineSideLabels(bestOfId, sides)

  return title ? (
    <Trans t={t} i18nKey='lobbies.room.chat.bestOfStartedTitled'>
      Series started: <SystemImportant>{{ title } as TransInterpolation}</SystemImportant> · Best of{' '}
      {{ length }} · <SystemImportant>{{ side1 } as TransInterpolation}</SystemImportant> vs{' '}
      <SystemImportant>{{ side2 } as TransInterpolation}</SystemImportant>
    </Trans>
  ) : (
    <Trans t={t} i18nKey='lobbies.room.chat.bestOfStarted'>
      Series started: Best of {{ length }} ·{' '}
      <SystemImportant>{{ side1 } as TransInterpolation}</SystemImportant> vs{' '}
      <SystemImportant>{{ side2 } as TransInterpolation}</SystemImportant>
    </Trans>
  )
}

/** Announces how a best-of series ended: who won it and by how much, or the score it stopped at. */
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
