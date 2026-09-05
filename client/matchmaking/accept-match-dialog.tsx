import { useAtomValue } from 'jotai'
import * as m from 'motion/react-m'
import { useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { range } from '../../common/range'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useKeyListener } from '../keyboard/key-listener'
import { FilledButton, TextButton } from '../material/button'
import { accelerateEasing, decelerateEasing, standardEasing } from '../material/curve-constants'
import { CloseButton, Dialog, Title } from '../material/dialog'
import { BodyMedium, sofiaSansCondensed } from '../styles/typography'
import { isInDraftAtom } from './draft-atoms'
import {
  currentSearchInfoAtom,
  foundMatchAtom,
  hasAcceptedAtom,
  matchLaunchingAtom,
} from './matchmaking-atoms'
import { useAcceptCountdown } from './use-accept-countdown'
import { useAcceptMatch } from './use-accept-match'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

/**
 * How many cells the accept countdown strip is divided into. Chosen so each cell covers a whole
 * number of seconds of the accept window (5s at the standard 60s), keeping the per-second melt
 * notches evenly sized across every cell and the final cell entirely in the low-time phase.
 */
const TIMER_CELL_COUNT = 12
/**
 * How often the countdown re-renders. The cells melt in per-second notches, but a fast tick keeps
 * the notch (and the waiting-state drain bar) landing close to the true second boundary.
 */
const TIMER_TICK_MS = 100

const StyledDialog = styled(Dialog)`
  width: 400px;

  & ${Title} {
    text-align: center;
  }

  /*
    The title is centered on the dialog, not on the space left beside the close button, so the
    button is lifted out of the title bar's flow and sits in the corner over the title's padding.
  */
  & ${CloseButton} {
    position: absolute;
    top: 0;
    right: 0;
  }
`

const StateContent = styled(m.div)`
  text-align: center;
`

const AcceptMatchButton = styled(FilledButton)`
  width: 100%;
  height: 44px;
  margin-top: 20px;
`

const lowPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
`

/*
  The leading-cell flash re-runs every second. Swapping between two equivalent
  keyframes each second restarts the animation without remounting the element (which would also
  reset the in-flight drain transitions on the cell itself). Use different keyframe selectors so
  styled-components generates distinct animation names instead of deduplicating the pair.
*/
/*
  The flash briefly heats the color up (hue toward orange) rather than brightening it — the amber is
  already at full RGB saturation, so any real brightness lift just clips the channels toward
  white and reads as pale instead of intense. Keep the resting glow on the cell itself so the
  flash does not introduce a separate halo on its first notch.
*/
const cellFlashA = keyframes`
  from { filter: hue-rotate(-15deg) brightness(1.1); }
  to { filter: hue-rotate(0deg) brightness(1); }
`
const cellFlashB = keyframes`
  0% { filter: hue-rotate(-15deg) brightness(1.1); }
  100% { filter: hue-rotate(0deg) brightness(1); }
`
const TimerCellRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 18px;
`

const TimerCell = styled.div`
  width: 10px;
  height: 18px;
  border-radius: 2px;

  background-color: var(--theme-container-highest);
  box-shadow:
    0 0 0 1px var(--theme-container-highest),
    0 0 6px rgb(from var(--theme-container-highest) r g b / 0.4);
  transform: skewX(-14deg);
`

const CellFlash = styled.div<{ $flash?: 'a' | 'b' }>`
  width: 100%;
  height: 100%;
  border-radius: inherit;
  animation: ${props =>
    props.$flash
      ? css`
          ${props.$flash === 'a' ? cellFlashA : cellFlashB} 0.18s ${decelerateEasing}
        `
      : 'none'};
`

const TimerCellFill = styled.div<{ $lit: boolean; $pulsing: boolean }>`
  width: 100%;
  height: 100%;
  border-radius: inherit;

  animation: ${props =>
    props.$pulsing
      ? css`
          ${lowPulse} 0.9s ease-in-out infinite
        `
      : 'none'};
  transition:
    background-color 0.2s,
    transform
      ${props => (props.$lit ? css`0.06s ${decelerateEasing}` : css`0.16s ${accelerateEasing}`)},
    opacity ${props => (props.$lit ? css`0.06s ${decelerateEasing}` : '0.08s linear 0.08s')},
    box-shadow ${props => (props.$lit ? '0s' : '0.16s linear')};
`

const TimerText = styled.span<{ $low: boolean }>`
  ${sofiaSansCondensed};
  font-size: 20px;
  line-height: 24px;

  display: inline-block;
  margin-left: 8px;

  color: ${props => (props.$low ? 'var(--theme-error)' : 'var(--color-grey-blue80)')};
  font-variant-numeric: tabular-nums;
`

const PlayerCellRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 22px;
`

const PlayerCell = styled.div<{ $ready: boolean }>`
  width: 18px;
  height: 30px;
  border-radius: 3px;

  background-color: ${props => (props.$ready ? 'var(--theme-amber)' : 'var(--color-blue40)')};
  box-shadow: ${props =>
    props.$ready ? '0 0 10px rgb(from var(--theme-amber) r g b / 0.6)' : 'none'};
  transform: skewX(-14deg);
  transition:
    background-color 0.25s ${standardEasing},
    box-shadow 0.25s ${standardEasing};
`

const PlayerCountText = styled.span`
  ${sofiaSansCondensed};
  font-size: 22px;
  line-height: 26px;

  margin-left: 10px;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const DrainBar = styled.div`
  height: 4px;
  margin-top: 20px;
  border-radius: 2px;

  background-color: var(--theme-container-highest);
  contain: paint;
`

const DrainBarFill = styled.div`
  height: 100%;
  transform-origin: 0 50%;
  transition:
    transform 0.12s linear,
    background-color 0.3s;
`

const fadeUpInitial = { opacity: 0, y: 8 }
const fadeUpAnimate = { opacity: 1, y: 0 }
const fadeUpTransition = { duration: 0.3, ease: [0, 0, 0, 1] as [number, number, number, number] }

export function AcceptMatchDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()

  const currentSearchInfo = useAtomValue(currentSearchInfoAtom)
  const foundMatch = useAtomValue(foundMatchAtom)
  // The found match is cleared when the match moves on to a draft or to launching, in the same
  // update that closes this dialog. The dialog stays mounted through its exit animation, so
  // without these it would render its "returning to queue" contents while fading out.
  const inDraft = useAtomValue(isInDraftAtom)
  const matchLaunching = useAtomValue(matchLaunchingAtom)
  const matchMovedOn = inDraft || matchLaunching

  useEffect(() => {
    if (!currentSearchInfo && !foundMatch) {
      close()
    } else if (currentSearchInfo && !foundMatch) {
      const timeout = setTimeout(() => {
        close()
      }, 5000)

      return () => {
        clearTimeout(timeout)
      }
    }

    return () => {}
  }, [currentSearchInfo, foundMatch, close])

  let contents: React.ReactNode | undefined
  if (currentSearchInfo && !foundMatch && !matchMovedOn) {
    contents = (
      <StateContent
        key='timeout'
        initial={fadeUpInitial}
        animate={fadeUpAnimate}
        transition={fadeUpTransition}>
        <BodyMedium>
          {t(
            'matchmaking.acceptMatch.returningToQueue',
            "Some players didn't ready up in time or failed to load. Returning to the matchmaking " +
              'queue…',
          )}
        </BodyMedium>
      </StateContent>
    )
  } else if (!foundMatch) {
    // In this case, the dialog is about to close anyway
    contents = undefined
  } else {
    contents = <AcceptingStateView close={close} />
  }

  return (
    <StyledDialog
      title={t('matchmaking.acceptMatch.matchFound', 'Match found')}
      overline={foundMatch ? matchmakingTypeToLabel(foundMatch.matchmakingType, t) : undefined}
      onCancel={onCancel}
      showCloseButton={true}>
      {contents}
    </StyledDialog>
  )
}

function AcceptingStateView({ close }: { close: () => void }) {
  const { t } = useTranslation()
  const hasAccepted = useAtomValue(hasAcceptedAtom)
  const foundMatch = useAtomValue(foundMatchAtom)

  // The countdown sounds are played by `AcceptMatchCountdownSounds`, which stays mounted when this
  // dialog is dismissed; nothing here makes a sound.
  const { secondsLeft, remainingFrac, lowTime } = useAcceptCountdown(foundMatch, TIMER_TICK_MS)
  const acceptTimeTotal = foundMatch?.acceptTimeTotalMillis ?? 0
  const parity = secondsLeft % 2 === 1

  const acceptButtonRef = useRef<HTMLButtonElement>(null)
  const { acceptInProgress, triggerAccept } = useAcceptMatch(close)

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        acceptButtonRef.current?.click()
        return true
      }

      return false
    },
  })

  const numPlayers = foundMatch?.numPlayers ?? 0
  const acceptedPlayers = foundMatch?.acceptedPlayers ?? 0

  if (!hasAccepted) {
    // Quantized to whole seconds so the leading cell melts in discrete notches that land exactly
    // on the ticks (and thus stay in sync with the flash and the tick sounds), rather than
    // draining smoothly between them.
    const cellValue = ((secondsLeft * 1000) / acceptTimeTotal) * TIMER_CELL_COUNT
    const leadIndex = Math.ceil(cellValue) - 1
    // The flash accompanies a cell that just lost a notch but survived. On ticks where a cell
    // dies instead, its collapse animation is the only accent — flashing the next cell at the
    // same moment would have two cells animating at once.
    const prevCellValue = (((secondsLeft + 1) * 1000) / acceptTimeTotal) * TIMER_CELL_COUNT
    const flashIndex =
      Math.ceil(prevCellValue) - 1 === leadIndex && prevCellValue <= TIMER_CELL_COUNT
        ? leadIndex
        : -1
    const timerCells = Array.from(range(0, TIMER_CELL_COUNT), i => {
      const fill = Math.max(0, Math.min(1, cellValue - i))
      const lit = fill > 0

      let flash: 'a' | 'b' | undefined
      if (lit && i === flashIndex) {
        flash = parity ? 'a' : 'b'
      }

      return (
        <TimerCell key={i}>
          <CellFlash $flash={flash}>
            <TimerCellFill
              $lit={lit}
              $pulsing={lit && lowTime}
              style={{
                backgroundColor: lowTime ? 'var(--theme-error)' : 'var(--theme-amber)',
                boxShadow:
                  lit && !lowTime
                    ? `0 0 6px rgb(from var(--theme-amber) r g b / ${(0.4 * fill).toFixed(2)})`
                    : 'none',
                opacity: lit ? 0.6 + 0.4 * fill : 0,
                transform: `scaleY(${Math.pow(fill, 0.6).toFixed(2)})`,
              }}
            />
          </CellFlash>
        </TimerCell>
      )
    })

    return (
      <StateContent
        key='accept'
        initial={fadeUpInitial}
        animate={fadeUpAnimate}
        transition={fadeUpTransition}>
        <BodyMedium>
          {t('matchmaking.acceptMatch.body', 'All players must ready up for the match to start.')}
        </BodyMedium>
        <AcceptMatchButton
          ref={acceptButtonRef}
          label={t('matchmaking.acceptMatch.readyUp', 'Ready up')}
          onClick={() => triggerAccept()}
          disabled={acceptInProgress}
        />
        <TimerCellRow>
          {timerCells}
          <TimerText $low={lowTime}>
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </TimerText>
        </TimerCellRow>
      </StateContent>
    )
  } else {
    const waitingCount = Math.max(0, numPlayers - acceptedPlayers)
    return (
      <StateContent
        key='waiting'
        initial={fadeUpInitial}
        animate={fadeUpAnimate}
        transition={fadeUpTransition}>
        <BodyMedium>
          <Trans t={t} i18nKey='matchmaking.acceptMatch.waitingForPlayers' count={waitingCount}>
            Waiting for {{ count: waitingCount }} more players…
          </Trans>
        </BodyMedium>
        <PlayerCellRow>
          {Array.from(range(0, numPlayers), i => (
            <PlayerCell key={i} $ready={i < acceptedPlayers} />
          ))}
          <PlayerCountText>
            {acceptedPlayers}/{numPlayers}
          </PlayerCountText>
        </PlayerCellRow>
        <DrainBar>
          <DrainBarFill
            style={{
              transform: `scaleX(${remainingFrac.toFixed(3)})`,
              backgroundColor: lowTime ? 'var(--theme-error)' : 'var(--theme-amber)',
            }}
          />
        </DrainBar>
      </StateContent>
    )
  }
}

export function FailedToAcceptMatchDialog({ onCancel }: CommonDialogProps) {
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

  return (
    <StyledDialog
      title={t('matchmaking.acceptMatch.failedToAccept', 'Failed to accept')}
      onCancel={onCancel}
      showCloseButton={true}
      buttons={[
        <TextButton key='ok' label={t('common.actions.okay', 'Okay')} onClick={onCancel} />,
      ]}>
      <p>
        {t(
          'matchmaking.acceptMatch.removedFromQueue',
          "You didn't ready up in time and have been removed from the queue.",
        )}
      </p>
    </StyledDialog>
  )
}
