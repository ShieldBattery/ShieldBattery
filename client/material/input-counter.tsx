import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import styled from 'styled-components'
import { bodySmall } from '../styles/typography'

/**
 * The number of remaining characters at (or below) which the counter becomes visible. Until the
 * input gets this close to its limit, the counter stays hidden to avoid visual noise.
 */
export const COUNTER_VISIBLE_REMAINING = 200

const StyledContainer = styled.div`
  min-height: 20px;
  padding: 2px 12px;

  display: flex;
  align-items: center;
  pointer-events: none;
`

const CounterText = styled(m.div)<{ $error?: boolean }>`
  ${bodySmall};
  color: ${props => (props.$error ? 'var(--theme-error)' : 'var(--theme-on-surface-variant)')};
  pointer-events: none;
`

const counterVariants: Variants = {
  initial: {
    opacity: 0,
    y: '-30%',
  },
  visible: {
    opacity: 1,
    y: 0,
  },
  exit: {
    opacity: 0,
    y: '-30%',
  },
}

const counterTransition: Transition = {
  default: { type: 'spring', duration: 0.3 },
  opacity: { type: 'spring', duration: 0.2, bounce: 0 },
}

export interface InputCounterProps {
  /** The current value of the input this counter is attached to. */
  value: string
  /**
   * The maximum allowed length of the value. The counter displays how many more characters fit,
   * going negative (and switching to the error color) once the value exceeds this.
   */
  maxLength: number
  className?: string
}

/**
 * A character counter for text inputs, displaying the number of remaining characters once the
 * value approaches `maxLength`. Exceeding the limit shows a negative count in the error color.
 * Note that this is purely informational and doesn't prevent input past the limit, so that
 * validation can surface an error instead of input silently getting cut off.
 */
export function InputCounter({ value, maxLength, className }: InputCounterProps) {
  const remaining = maxLength - value.length

  return (
    <StyledContainer className={className}>
      <AnimatePresence>
        {remaining <= COUNTER_VISIBLE_REMAINING ? (
          <CounterText
            key='counter'
            $error={remaining < 0}
            data-testid='input-counter'
            variants={counterVariants}
            initial='initial'
            animate='visible'
            exit='exit'
            transition={counterTransition}>
            {remaining}
          </CounterText>
        ) : null}
      </AnimatePresence>
    </StyledContainer>
  )
}
