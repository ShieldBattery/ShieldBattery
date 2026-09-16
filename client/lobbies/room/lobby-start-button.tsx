import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { buttonReset } from '../../material/button-reset'
import { labelLarge, labelSmall } from '../../styles/typography'
import { START_GAME_HOLD_MS, useStartGameHold } from './use-start-game-hold'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ButtonFrame = styled.div`
  position: relative;
`

const ReadyGlow = styled(m.span)`
  position: absolute;
  inset: 2px;
  border-radius: 6px;
  box-shadow: 0 0 20px 2px rgb(from var(--theme-primary) r g b / 0.3);
  pointer-events: none;
`

const StartButton = styled(m.button)<{ $ready: boolean }>`
  ${buttonReset};
  ${labelLarge};
  width: 100%;
  min-height: 44px;
  padding: 10px 16px;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid ${props => (props.$ready ? 'var(--theme-primary)' : 'var(--theme-outline)')};
  border-radius: 6px;
  color: var(--theme-on-primary);
  isolation: isolate;
  touch-action: none;

  &:enabled:hover {
    border-color: var(--theme-primary);
  }

  &:disabled {
    cursor: default;
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
    background-color: rgb(from var(--theme-on-surface) r g b / 0.12);
    border-color: transparent;
  }
`

const ReadyFill = styled(m.span)`
  position: absolute;
  inset: 0;
  z-index: -1;
  background-color: var(--theme-primary);
  pointer-events: none;
`

const HoldFill = styled(m.span)`
  position: absolute;
  inset: 0 auto 0 0;
  z-index: -1;
  background-color: var(--theme-primary);
  box-shadow: 2px 0 12px rgb(from var(--theme-primary) r g b / 0.45);
  pointer-events: none;
`

const ButtonLabel = styled(m.span)`
  display: block;
  pointer-events: none;
`

const Hint = styled(m.div)`
  ${labelSmall};
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-on-surface-variant);
  text-align: center;
`

/** Starts immediately when everyone is ready, or after a deliberate hold to bypass readiness. */
export function LobbyStartButton({
  allReady,
  disabled,
  onStartGame,
  onForceStart,
}: {
  allReady: boolean
  disabled: boolean
  onStartGame: () => void
  onForceStart: () => void
}) {
  const { t } = useTranslation()
  const hintId = useId()
  const reducedMotion = useReducedMotion()
  const { isHolding, showHoldHint, buttonProps } = useStartGameHold({
    allReady,
    disabled,
    onStartGame,
    onForceStart,
  })
  const ready = allReady && !disabled
  const label =
    !disabled && !allReady && (isHolding || showHoldHint)
      ? t('lobbies.room.rail.holdToStartAnyway', 'Hold to start anyway')
      : t('lobbies.room.rail.startGame', 'Start game')

  let hint: string
  if (disabled) {
    hint = t('lobbies.room.rail.needsOpposingSides', 'Needs at least two opposing players')
  } else if (ready) {
    hint = t('lobbies.room.rail.everyoneReady', 'Everyone is ready')
  } else {
    hint = t(
      'lobbies.room.rail.holdToBypassReadiness',
      'Hold for {{seconds}} seconds to start without waiting',
      { seconds: START_GAME_HOLD_MS / 1000 },
    )
  }

  return (
    <Root>
      <ButtonFrame>
        <ReadyGlow
          aria-hidden={true}
          initial={false}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.4 }}
        />
        <StartButton
          {...buttonProps}
          type='button'
          disabled={disabled}
          $ready={ready}
          aria-describedby={hintId}
          data-testid='start-game-button'
          animate={{ scale: isHolding && !reducedMotion ? 0.985 : 1 }}
          transition={{ duration: 0.15 }}>
          <ReadyFill
            aria-hidden={true}
            initial={false}
            animate={{ opacity: ready ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.25 }}
          />
          <HoldFill
            aria-hidden={true}
            initial={{ width: '0%' }}
            animate={{ width: isHolding ? '100%' : '0%' }}
            transition={{ duration: isHolding ? START_GAME_HOLD_MS / 1000 : 0.15, ease: 'linear' }}
          />
          <AnimatePresence initial={false} mode='wait'>
            <ButtonLabel
              key={label}
              initial={{ opacity: 0, y: reducedMotion ? 0 : 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -3 }}
              transition={{ duration: reducedMotion ? 0 : 0.1 }}>
              {label}
            </ButtonLabel>
          </AnimatePresence>
        </StartButton>
      </ButtonFrame>
      <Hint
        id={hintId}
        aria-live='polite'
        animate={{
          color:
            isHolding || showHoldHint
              ? 'var(--theme-on-surface)'
              : 'var(--theme-on-surface-variant)',
        }}
        transition={{ duration: 0.15 }}>
        {hint}
      </Hint>
    </Root>
  )
}
