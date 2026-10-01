import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchCanceledReason } from '../../common/matchmaking'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useKeyListener } from '../keyboard/key-listener'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { BodyLarge, TitleMedium } from '../styles/typography'
import { CanceledMatch } from './matchmaking-atoms'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const StyledDialog = styled(Dialog)`
  width: 440px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

function getCauseText(
  t: TFunction,
  phase: CanceledMatch['phase'],
  reason: MatchCanceledReason,
): string {
  switch (reason) {
    case 'setupUnresolved':
      return t(
        'matchmaking.matchCanceled.setupUnresolved',
        "The game could not start, and we couldn't determine the cause.",
      )
    case 'gameAnomaly':
      return t('game.gameAnomaly', 'Game anomalies detected')
    case 'playerLeft':
      return phase === 'draft'
        ? t(
            'matchmaking.matchCanceled.draftPlayerLeft',
            'A player left during the race draft, so the match was canceled.',
          )
        : t(
            'matchmaking.matchCanceled.loadPlayerLeft',
            'A player left before the game could start, so the match was canceled.',
          )
    case 'playerFailedToLoad':
      return t(
        'matchmaking.matchCanceled.playerFailedToLoad',
        "A player disconnected or failed to load, so the game couldn't start.",
      )
    case 'loadTimeout':
      return t(
        'matchmaking.matchCanceled.loadTimeout',
        "A player took too long to load, so the game couldn't start.",
      )
    case 'error':
      return phase === 'draft'
        ? t(
            'matchmaking.matchCanceled.draftError',
            'The race draft was canceled because of a server error.',
          )
        : t(
            'matchmaking.matchCanceled.loadError',
            "The game couldn't start because of a server error.",
          )
    default:
      return assertUnreachable(reason)
  }
}

export interface MatchCanceledDialogProps extends CommonDialogProps, CanceledMatch {}

function getPenaltyText(
  t: TFunction,
  penalty: NonNullable<CanceledMatch['penalty']>,
  queueRemoved: boolean,
): string {
  switch (penalty) {
    case 'lossAndBan':
      if (!queueRemoved) {
        return t(
          'matchmaking.matchCanceled.anomalyPastBan',
          'A matchmaking ban was issued for this match.',
        )
      }
      return t(
        'matchmaking.matchCanceled.anomalyBan',
        'You have been banned from matchmaking and removed from the queue.',
      )
    case 'lossAndWarning':
      if (!queueRemoved) {
        return t(
          'matchmaking.matchCanceled.anomalyPastWarning',
          'You received a matchmaking warning.',
        )
      }
      return t(
        'matchmaking.matchCanceled.anomalyWarning',
        'You received a matchmaking warning and have been removed from the queue.',
      )
    case 'pending':
      return t(
        'matchmaking.matchCanceled.anomalyPenaltyPending',
        'Your matchmaking penalty is being processed. You have been removed from the queue.',
      )
    default:
      return assertUnreachable(penalty)
  }
}

/**
 * Explains why a match was canceled once the server has resolved whether this player was requeued
 * or removed. An anomaly penalty is shown only to the affected player.
 */
export function MatchCanceledDialog({
  phase,
  reason,
  penalty,
  requeued = true,
  queueRemoved = true,
  onCancel,
}: MatchCanceledDialogProps) {
  const { t } = useTranslation()

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onCancel()
        return true
      }

      return false
    },
  })

  const additionalContent = (() => {
    if (penalty) {
      return (
        <>
          {penalty !== 'pending' ? (
            <BodyLarge>
              {t(
                'matchmaking.matchCanceled.anomalyLoss',
                'A loss has been recorded for this match.',
              )}
            </BodyLarge>
          ) : null}
          <BodyLarge>{getPenaltyText(t, penalty, queueRemoved)}</BodyLarge>
        </>
      )
    }

    if (reason === 'gameAnomaly') {
      return (
        <>
          <BodyLarge>
            {t(
              'matchmaking.matchCanceled.anomalyInnocent',
              'The game was canceled before it could start. No win or loss was recorded for you. Your rating and points are unchanged.',
            )}
          </BodyLarge>
          <TitleMedium>
            {requeued
              ? t(
                  'matchmaking.matchCanceled.backInQueue',
                  "You're back in the matchmaking queue, searching for a new match.",
                )
              : t(
                  'matchmaking.matchCanceled.removedFromQueue',
                  'You have been removed from the matchmaking queue.',
                )}
          </TitleMedium>
        </>
      )
    }

    let explanation: string | undefined
    if (reason === 'setupUnresolved') {
      explanation = t(
        'matchmaking.matchCanceled.noPenalty',
        'No win or loss has been recorded, and no matchmaking penalty was applied.',
      )
    } else if (reason !== 'error') {
      explanation = t(
        'matchmaking.matchCanceled.notYourFault',
        "This wasn't your fault. Whoever caused it has been removed from the queue.",
      )
    }

    return (
      <>
        {explanation ? <BodyLarge>{explanation}</BodyLarge> : null}
        <TitleMedium>
          {t(
            'matchmaking.matchCanceled.backInQueue',
            "You're back in the matchmaking queue, searching for a new match.",
          )}
        </TitleMedium>
      </>
    )
  })()

  return (
    <StyledDialog
      title={t('matchmaking.matchCanceled.title', 'Match canceled')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='ok' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
      ]}>
      <Content>
        <BodyLarge>{getCauseText(t, phase, reason)}</BodyLarge>
        {additionalContent}
      </Content>
    </StyledDialog>
  )
}
