import { TFunction } from 'i18next'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchCanceledReason } from '../../common/matchmaking'
import { openDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge, bodyMedium, labelMedium, titleSmall } from '../styles/typography'
import { CanceledMatch } from './matchmaking-atoms'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const StyledDialog = styled(Dialog)`
  width: 440px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const Lead = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface);
`

/** Names the player's own game as the source of the anomaly, so the penalty below reads as its result. */
const Attribution = styled.div`
  display: flex;
  gap: 12px;
  padding: 12px 16px 14px 12px;

  border: 1px solid rgb(from var(--theme-negative) r g b / 0.32);
  border-radius: 8px;
  background-color: rgb(from var(--theme-negative) r g b / 0.1);
`

const AttributionIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--theme-negative);
`

const AttributionText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const AttributionTitle = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const AttributionBody = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const Outcomes = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const OutcomesLabel = styled.div`
  ${labelMedium};
  margin-bottom: -4px;
  color: var(--theme-on-surface-variant);
  /* Matches the dialog overline's eyebrow treatment */
  letter-spacing: 1.6px;
  text-transform: uppercase;
`

type OutcomeTone = 'positive' | 'negative' | 'warning' | 'queue' | 'neutral'

const TONE_COLORS: Record<OutcomeTone, string> = {
  positive: 'var(--theme-positive)',
  negative: 'var(--theme-negative)',
  warning: 'var(--theme-amber)',
  queue: 'var(--theme-amber)',
  neutral: 'var(--theme-on-surface-variant)',
}

const OutcomeRow = styled(m.div)`
  display: flex;
  align-items: flex-start;
  gap: 14px;
`

const ping = keyframes`
  0% {
    transform: scale(1);
    opacity: 0.5;
  }

  55%, 100% {
    transform: scale(1.7);
    opacity: 0;
  }
`

const OutcomeIconTile = styled.div<{ $tone: OutcomeTone; $live: boolean }>`
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 36px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: rgb(from ${props => TONE_COLORS[props.$tone]} r g b / 0.16);
  color: ${props => TONE_COLORS[props.$tone]};

  /* A live search pings like the radar it is, with a still beat between pings */
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    display: ${props => (props.$live ? 'block' : 'none')};
    border-radius: 50%;
    border: 1.5px solid ${props => TONE_COLORS[props.$tone]};
    animation: ${ping} 2.4s cubic-bezier(0.2, 0.6, 0.35, 1) 600ms infinite backwards;
  }

  @media (prefers-reduced-motion: reduce) {
    &::after {
      animation: none;
      display: none;
    }
  }
`

const OutcomeText = styled.div`
  min-width: 0;
  padding-top: 1px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const OutcomeTitle = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const OutcomeDescription = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

interface Outcome {
  key: string
  tone: OutcomeTone
  icon: string
  title: string
  description: string
  /** Whether this is an ongoing matchmaking search, drawn as a live indicator. */
  live?: boolean
}

function getLeadText(
  t: TFunction,
  phase: CanceledMatch['phase'],
  reason: MatchCanceledReason,
): string {
  switch (reason) {
    case 'setupUnresolved':
      return t(
        'matchmaking.matchCanceled.leadSetupUnresolved',
        "The game couldn't start, and the cause couldn't be determined.",
      )
    case 'gameAnomaly':
      return t(
        'matchmaking.matchCanceled.leadAnomalyFromOtherPlayer',
        "Game anomalies were detected from another player's game, so the match was stopped.",
      )
    case 'playerLeft':
      return phase === 'draft'
        ? t('matchmaking.matchCanceled.leadPlayerLeftDraft', 'A player left during the draft.')
        : t(
            'matchmaking.matchCanceled.leadLoadPlayerLeft',
            'A player left before the game could start.',
          )
    case 'playerFailedToLoad':
      return t(
        'matchmaking.matchCanceled.leadPlayerFailedToLoad',
        'A player disconnected or failed to load the game.',
      )
    case 'loadTimeout':
      return t(
        'matchmaking.matchCanceled.leadLoadTimeout',
        'A player took too long to load the game.',
      )
    case 'error':
      return phase === 'draft'
        ? t(
            'matchmaking.matchCanceled.leadErrorDraft',
            'The draft was interrupted by a server error.',
          )
        : t(
            'matchmaking.matchCanceled.leadLoadError',
            "The game couldn't start because of a server error.",
          )
    default:
      return assertUnreachable(reason)
  }
}

function getQueueOutcome(t: TFunction, requeued: boolean): Outcome {
  return requeued
    ? {
        key: 'queue',
        tone: 'queue',
        icon: 'search',
        title: t('matchmaking.matchCanceled.backInQueueTitle', 'Back in the queue'),
        description: t(
          'matchmaking.matchCanceled.backInQueueDescription',
          'Searching for a new match.',
        ),
        live: true,
      }
    : {
        key: 'queue',
        tone: 'neutral',
        icon: 'search_off',
        title: t('matchmaking.matchCanceled.removedFromQueueTitle', 'Removed from the queue'),
        description: t(
          'matchmaking.matchCanceled.removedFromQueueDescription',
          "You can search again whenever you're ready.",
        ),
      }
}

/** What the cancellation means for a player who didn't cause it. */
function getBystanderOutcomes(
  t: TFunction,
  reason: MatchCanceledReason,
  requeued: boolean,
): Outcome[] {
  let noPenalty: Outcome
  switch (reason) {
    case 'playerLeft':
    case 'playerFailedToLoad':
    case 'loadTimeout':
      noPenalty = {
        key: 'penalty',
        tone: 'positive',
        icon: 'verified_user',
        title: t('matchmaking.matchCanceled.notYourFaultTitle', 'Not your fault'),
        description: t(
          'matchmaking.matchCanceled.notYourFaultDescription',
          'The player responsible was removed from the queue.',
        ),
      }
      break
    case 'gameAnomaly':
      noPenalty = {
        key: 'penalty',
        tone: 'positive',
        icon: 'verified_user',
        title: t('matchmaking.matchCanceled.noPenaltyTitle', 'No penalty for you'),
        description: t(
          'matchmaking.matchCanceled.anomalyNoPenaltyDescription',
          'No win or loss was recorded. Your rating and points are unchanged.',
        ),
      }
      break
    case 'setupUnresolved':
      noPenalty = {
        key: 'penalty',
        tone: 'positive',
        icon: 'verified_user',
        title: t('matchmaking.matchCanceled.noPenaltyTitle', 'No penalty for you'),
        description: t(
          'matchmaking.matchCanceled.unresolvedNoPenaltyDescription',
          'No win or loss was recorded, and no one was penalized.',
        ),
      }
      break
    case 'error':
      noPenalty = {
        key: 'penalty',
        tone: 'positive',
        icon: 'verified_user',
        title: t('matchmaking.matchCanceled.noPenaltyTitle', 'No penalty for you'),
        description: t(
          'matchmaking.matchCanceled.errorNoPenaltyDescription',
          'No win or loss was recorded.',
        ),
      }
      break
    default:
      noPenalty = assertUnreachable(reason)
  }

  return [noPenalty, getQueueOutcome(t, requeued)]
}

/** The consequences for the player whose game the anomaly came from. */
function getOffenderOutcomes(
  t: TFunction,
  penalty: NonNullable<CanceledMatch['penalty']>,
  queueRemoved: boolean,
): Outcome[] {
  const removed = getQueueOutcome(t, false)
  switch (penalty) {
    case 'pending':
      return [
        {
          key: 'pending',
          tone: 'warning',
          icon: 'hourglass_top',
          title: t('matchmaking.matchCanceled.penaltyPendingTitle', 'Penalty being applied'),
          description: t(
            'matchmaking.matchCanceled.penaltyPendingDescription',
            'A loss and a matchmaking penalty are being recorded for this match.',
          ),
        },
        removed,
      ]
    case 'lossAndBan':
    case 'lossAndWarning': {
      const outcomes: Outcome[] = [
        {
          key: 'loss',
          tone: 'negative',
          icon: 'trending_down',
          title: t('matchmaking.matchCanceled.lossTitle', 'Loss recorded'),
          description: t(
            'matchmaking.matchCanceled.lossDescription',
            'This match counts as a loss against your rating.',
          ),
        },
      ]
      if (penalty === 'lossAndBan') {
        outcomes.push({
          key: 'ban',
          tone: 'negative',
          icon: 'block',
          title: t('matchmaking.matchCanceled.banTitle', 'Banned from matchmaking'),
          description: queueRemoved
            ? t(
                'matchmaking.matchCanceled.banRemovedDescription',
                "You were removed from the queue and can't search again until the ban ends.",
              )
            : t(
                'matchmaking.matchCanceled.banDescription',
                "You can't search for matches until the ban ends.",
              ),
        })
      } else {
        outcomes.push({
          key: 'warning',
          tone: 'warning',
          icon: 'warning',
          title: t('matchmaking.matchCanceled.warningTitle', 'Matchmaking warning'),
          description: t(
            'matchmaking.matchCanceled.warningDescription',
            'Repeat violations lead to matchmaking bans.',
          ),
        })
        if (queueRemoved) {
          outcomes.push(removed)
        }
      }
      return outcomes
    }
    default:
      return assertUnreachable(penalty)
  }
}

const rowInitial = { opacity: 0, y: 6 }
const rowAnimate = { opacity: 1, y: 0 }

export interface MatchCanceledDialogProps extends CommonDialogProps, CanceledMatch {}

/**
 * Explains why a match was canceled once the server has resolved whether this player was requeued
 * or removed. A player whose game caused an anomaly is told it came from them, and that their
 * penalty follows from it.
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
  const dispatch = useAppDispatch()

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onCancel()
        return true
      }

      return false
    },
  })

  const outcomes = penalty
    ? getOffenderOutcomes(t, penalty, queueRemoved)
    : getBystanderOutcomes(t, reason, requeued)

  // When no one could be blamed for a game not starting, any player's logs might hold the cause, so
  // each of them is offered a bug report (which uploads them). The web client has no logs to send.
  const buttons = [
    <TextButton key='ok' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
  ]
  if (IS_ELECTRON && reason === 'setupUnresolved') {
    buttons.unshift(
      <TextButton
        key='report-bug'
        label={t('matchmaking.matchCanceled.reportBug', 'Report a bug')}
        onClick={() => {
          onCancel()
          dispatch(openDialog({ type: DialogType.BugReport }))
        }}
      />,
    )
  }

  return (
    <StyledDialog
      title={t('matchmaking.matchCanceled.title', 'Match canceled')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={buttons}>
      <Content>
        {penalty ? (
          <Attribution>
            <AttributionIcon icon='gpp_bad' size={24} />
            <AttributionText>
              <AttributionTitle>
                {t(
                  'matchmaking.matchCanceled.anomalyFromYouTitle',
                  'Game anomalies detected from your game',
                )}
              </AttributionTitle>
              <AttributionBody>
                {t(
                  'matchmaking.matchCanceled.anomalyFromYouDescription',
                  "Your game sent match setup commands that ShieldBattery doesn't allow. This " +
                    'usually means the game was modified, or another program interfered with it.',
                )}
              </AttributionBody>
            </AttributionText>
          </Attribution>
        ) : (
          <Lead>{getLeadText(t, phase, reason)}</Lead>
        )}
        <Outcomes>
          {penalty ? (
            <OutcomesLabel>
              {t('matchmaking.matchCanceled.becauseOfThis', 'Because of this')}
            </OutcomesLabel>
          ) : null}
          {outcomes.map((outcome, i) => (
            <OutcomeRow
              key={outcome.key}
              initial={rowInitial}
              animate={rowAnimate}
              transition={{ duration: 0.22, ease: 'easeOut', delay: 0.12 + i * 0.07 }}>
              <OutcomeIconTile $tone={outcome.tone} $live={!!outcome.live}>
                <MaterialIcon icon={outcome.icon} size={20} />
              </OutcomeIconTile>
              <OutcomeText>
                <OutcomeTitle>{outcome.title}</OutcomeTitle>
                <OutcomeDescription>{outcome.description}</OutcomeDescription>
              </OutcomeText>
            </OutcomeRow>
          ))}
        </Outcomes>
      </Content>
    </StyledDialog>
  )
}
