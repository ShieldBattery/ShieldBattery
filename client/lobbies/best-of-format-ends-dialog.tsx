import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { bodyLarge } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

const Body = styled.div`
  ${bodyLarge};
`

export interface LobbyBestOfFormatEndsDialogProps extends CommonDialogProps {
  /** The format the host is saving. */
  length: number
  playAll: boolean
  /** The series' score, in side order. */
  score: [number, number]
  /** How the format ends the series: won by a side (named by its label) or drawn. */
  outcome: { kind: 'won'; winner: 0 | 1; winnerLabel: string } | { kind: 'drawn' }
  /** Saves the host's changes, once they have confirmed it. */
  onConfirm: () => void
}

/**
 * Confirms saving a length (or a switch to or from playing every game) that the running best-of
 * series' current results already decide, so saving it ends the series. Says only what changes: how
 * the series ends under the new format.
 */
export function LobbyBestOfFormatEndsDialog({
  onCancel,
  close,
  length,
  playAll,
  score,
  outcome,
  onConfirm,
}: LobbyBestOfFormatEndsDialogProps) {
  const { t } = useTranslation()

  let body: string
  if (outcome.kind === 'won') {
    const winnerScore = score[outcome.winner]
    const loserScore = score[outcome.winner === 0 ? 1 : 0]
    body = playAll
      ? t('lobbies.bestOfFormatEndsDialog.playAllWon', {
          defaultValue_one:
            'Playing {{count}} game ends the series now: {{winner}} wins {{winnerScore}}–{{loserScore}}.',
          defaultValue_other:
            'Playing all {{count}} games ends the series now: {{winner}} wins {{winnerScore}}–{{loserScore}}.',
          count: length,
          winner: outcome.winnerLabel,
          winnerScore,
          loserScore,
        })
      : t('lobbies.bestOfFormatEndsDialog.bestOfWon', {
          defaultValue:
            'Best of {{length}} ends the series now: {{winner}} wins {{winnerScore}}–{{loserScore}}.',
          length,
          winner: outcome.winnerLabel,
          winnerScore,
          loserScore,
        })
  } else {
    body = playAll
      ? t('lobbies.bestOfFormatEndsDialog.playAllDrawn', {
          defaultValue_one:
            'Playing {{count}} game ends the series now as a draw at {{score1}}–{{score2}}.',
          defaultValue_other:
            'Playing all {{count}} games ends the series now as a draw at {{score1}}–{{score2}}.',
          count: length,
          score1: score[0],
          score2: score[1],
        })
      : t('lobbies.bestOfFormatEndsDialog.bestOfDrawn', {
          defaultValue:
            'Best of {{length}} ends the series now as a draw at {{score1}}–{{score2}}.',
          length,
          score1: score[0],
          score2: score[1],
        })
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('lobbies.bestOfFormatEndsDialog.confirmAction', 'Save and end series')}
      key='confirm'
      onClick={() => {
        close()
        onConfirm()
      }}
      testName='best-of-format-ends-confirm-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('lobbies.bestOfFormatEndsDialog.title', 'End the series?')}
      buttons={buttons}
      onCancel={onCancel}
      testName='best-of-format-ends-dialog'>
      <Body>{body}</Body>
    </StyledDialog>
  )
}
