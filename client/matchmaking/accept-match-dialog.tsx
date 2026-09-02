import { useAtomValue } from 'jotai'
import * as m from 'motion/react-m'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { MATCHMAKING_ACCEPT_MATCH_TIME_MS, matchmakingTypeToLabel } from '../../common/matchmaking'
import { range } from '../../common/range'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { playRandomTickSound } from '../audio/tick-sounds'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useKeyListener } from '../keyboard/key-listener'
import { FilledButton, TextButton } from '../material/button'
import { decelerateEasing, standardEasing } from '../material/curve-constants'
import { Dialog, Title } from '../material/dialog'
import { BodyMedium, sofiaSansCondensed } from '../styles/typography'
import { isInDraftAtom } from './draft-atoms'
import {
  currentSearchInfoAtom,
  foundMatchAtom,
  hasAcceptedAtom,
  matchLaunchingAtom,
} from './matchmaking-atoms'
import { useAcceptMatch } from './use-accept-match'

const ipcRenderer = new TypedIpcRenderer()

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

/**
 * How many cells the accept countdown strip is divided into. Chosen so each cell covers a whole
 * number of seconds of the accept window (3s at the standard 30s), keeping the per-second melt
 * notches evenly sized across every cell.
 */
const TIMER_CELL_COUNT = 10
/** Seconds remaining at which the countdown switches to the "low time" error treatment. */
const LOW_TIME_SECONDS = 5
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
  The leading-cell flash and the numeral pop re-run every second. Swapping between two identical
  keyframes each second restarts the animation without remounting the element (which would also
  reset the in-flight drain transitions on the cell itself).
*/
/*
  The flash heats the color up (hue toward orange) rather than brightening it — the amber is
  already at full RGB saturation, so any real brightness lift just clips the channels toward
  white and reads as pale instead of intense.
*/
const cellFlashA = keyframes`
  from { filter: hue-rotate(-15deg) brightness(1.1) drop-shadow(0 0 8px rgb(from var(--theme-amber) r g b / 0.85)); }
  to { filter: hue-rotate(0deg) brightness(1) drop-shadow(0 0 3px rgb(from var(--theme-amber) r g b / 0.35)); }
`
const cellFlashB = keyframes`
  from { filter: hue-rotate(-15deg) brightness(1.1) drop-shadow(0 0 8px rgb(from var(--theme-amber) r g b / 0.85)); }
  to { filter: hue-rotate(0deg) brightness(1) drop-shadow(0 0 3px rgb(from var(--theme-amber) r g b / 0.35)); }
`
const numeralPopA = keyframes`
  0% { transform: scale(1.28); }
  45% { transform: scale(0.96); }
  70% { transform: scale(1.04); }
  100% { transform: scale(1); }
`
const numeralPopB = keyframes`
  0% { transform: scale(1.28); }
  45% { transform: scale(0.96); }
  70% { transform: scale(1.04); }
  100% { transform: scale(1); }
`

const TimerCellRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 18px;
`

const CellFlash = styled.div<{ $flash?: 'a' | 'b' }>`
  animation: ${props =>
    props.$flash
      ? css`
          ${props.$flash === 'a' ? cellFlashA : cellFlashB} 0.85s ${decelerateEasing}
        `
      : 'none'};
`

const TimerCell = styled.div<{ $pulsing: boolean }>`
  width: 10px;
  height: 18px;
  border-radius: 2px;

  animation: ${props =>
    props.$pulsing
      ? css`
          ${lowPulse} 0.9s ease-in-out infinite
        `
      : 'none'};
  transition:
    background-color 0.2s,
    transform 0.12s linear,
    opacity 0.12s linear;
`

const TimerText = styled.span<{ $low: boolean; $parity: boolean }>`
  ${sofiaSansCondensed};
  font-size: 20px;
  line-height: 24px;

  display: inline-block;
  margin-left: 8px;
  transform-origin: center;

  color: ${props => (props.$low ? 'var(--theme-error)' : 'var(--color-grey-blue80)')};
  font-variant-numeric: tabular-nums;
  animation: ${props => css`
    ${props.$parity ? numeralPopA : numeralPopB} 0.4s ${decelerateEasing}
  `};
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

  const acceptTimeTotal = foundMatch?.acceptTimeTotalMillis ?? MATCHMAKING_ACCEPT_MATCH_TIME_MS
  const acceptStart = foundMatch?.acceptStart ?? window.performance.now()

  const [now, setNow] = useState(() => window.performance.now())
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(window.performance.now())
    }, TIMER_TICK_MS)

    return () => clearInterval(interval)
  }, [])

  const remainingMillis = Math.max(0, acceptTimeTotal - (now - acceptStart))
  const secondsLeft = Math.ceil(remainingMillis / 1000)
  const remainingFrac = acceptTimeTotal > 0 ? remainingMillis / acceptTimeTotal : 0
  const lowTime = secondsLeft <= LOW_TIME_SECONDS
  const parity = secondsLeft % 2 === 1

  const acceptButtonRef = useRef<HTMLButtonElement>(null)
  const { acceptInProgress, triggerAccept } = useAcceptMatch(close)

  // A value that never goes below 4 because the countdown sound covers all 5 ticks below that
  const soundTimeLeft = Math.max(4, secondsLeft)
  useEffect(() => {
    if (hasAccepted) {
      return () => {}
    }

    let sound: FadeableSound | undefined
    if (soundTimeLeft === 4) {
      sound = audioManager.playFadeableSound(AvailableSound.Countdown)
      ipcRenderer.send('userAttentionRequired')
    } else if (soundTimeLeft && soundTimeLeft > 4 && soundTimeLeft <= 10) {
      sound = playRandomTickSound()
      ipcRenderer.send('userAttentionRequired')
    }

    return () => {
      sound?.fadeOut()
    }
  }, [soundTimeLeft, hasAccepted])

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

      let backgroundColor = 'var(--theme-container-highest)'
      if (lit) {
        backgroundColor = lowTime ? 'var(--theme-error)' : 'var(--theme-amber)'
      }
      let flash: 'a' | 'b' | undefined
      if (lit && i === flashIndex) {
        flash = parity ? 'a' : 'b'
      }

      return (
        <CellFlash key={i} $flash={flash}>
          <TimerCell
            $pulsing={lit && lowTime}
            style={{
              backgroundColor,
              boxShadow:
                lit && !lowTime
                  ? `0 0 6px rgb(from var(--theme-amber) r g b / ${(0.4 * fill).toFixed(2)})`
                  : 'none',
              opacity: lit ? 0.3 + 0.7 * fill : 1,
              transform: `skewX(-14deg) scaleY(${lit ? (0.45 + 0.55 * fill).toFixed(2) : 1})`,
            }}
          />
        </CellFlash>
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
          <TimerText $low={lowTime} $parity={parity}>
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
