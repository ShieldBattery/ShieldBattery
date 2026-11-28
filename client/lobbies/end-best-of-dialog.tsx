import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  getBestOfScore,
  getBestOfSideName,
  getRunningBestOf,
} from '../../common/lobbies/lobby-best-of'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppSelector } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { useBestOfSideLabel } from './room/best-of-parts'

/** An empty side, shared so it reads the same on every render. */
const NO_PLAYERS: ReadonlyArray<SbUserId> = Object.freeze([])

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

const Body = styled.div`
  ${bodyLarge};
`

export interface LobbyEndBestOfDialogProps extends CommonDialogProps {
  onConfirm: () => void
}

/**
 * Confirms ending the lobby's running best-of series before either side has won it, stating where
 * it stands. The series is captured when this opens, so the text doesn't change under the host as
 * the ending lands.
 */
export function LobbyEndBestOfDialog({ onCancel, close, onConfirm }: LobbyEndBestOfDialogProps) {
  const { t } = useTranslation()
  const currentBestOf = useAppSelector(s => getRunningBestOf(s.lobby.bestOfs))
  const [bestOf] = useState(currentBestOf)
  const side1 = useBestOfSideLabel(
    bestOf?.sides[0] ?? NO_PLAYERS,
    bestOf ? getBestOfSideName(bestOf, 0) : undefined,
  )
  const side2 = useBestOfSideLabel(
    bestOf?.sides[1] ?? NO_PLAYERS,
    bestOf ? getBestOfSideName(bestOf, 1) : undefined,
  )
  const [score1, score2] = bestOf ? getBestOfScore(bestOf) : [0, 0]
  const hasPendingGame = bestOf?.games.some(game => game.status === 'pending') ?? false

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('lobbies.endBestOfDialog.confirmAction', 'End series')}
      key='confirm'
      onClick={() => {
        close()
        onConfirm()
      }}
      testName='end-best-of-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('lobbies.endBestOfDialog.title', 'End the series?')}
      buttons={buttons}
      onCancel={onCancel}>
      <Body>
        {hasPendingGame
          ? t('lobbies.endBestOfDialog.bodyPending', {
              defaultValue:
                "{{side1}} and {{side2}} are at {{score1}}–{{score2}}. Ending the series now leaves it unfinished, and a game still waiting for its result won't count.",
              side1,
              side2,
              score1,
              score2,
            })
          : t('lobbies.endBestOfDialog.body', {
              defaultValue:
                '{{side1}} and {{side2}} are at {{score1}}–{{score2}}. Ending the series now leaves it unfinished.',
              side1,
              side2,
              score1,
              score2,
            })}
      </Body>
    </StyledDialog>
  )
}
