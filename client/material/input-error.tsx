import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useRef } from 'react'
import styled from 'styled-components'
import { bodySmall } from '../styles/typography'

const StyledContainer = styled.div`
  display: flex;
  align-items: center;
  order: 4;
  height: 20px;
  padding: 0 12px;
  pointer-events: none;
`

const ErrorText = styled(m.div)`
  ${bodySmall};
  color: var(--theme-error);
  pointer-events: none;
`

const errorVariants: Variants = {
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

const errorTransition: Transition = {
  default: { type: 'spring', duration: 0.3 },
  opacity: { type: 'spring', duration: 0.2, bounce: 0 },
}

export interface InputErrorProps {
  error?: string
  className?: string
}

export function InputError(props: InputErrorProps) {
  const nodeRef = useRef(null)

  return (
    <StyledContainer className={props.className}>
      <AnimatePresence mode='wait'>
        {props.error ? (
          <ErrorText
            key='error'
            ref={nodeRef}
            data-test='validation-error'
            variants={errorVariants}
            initial='initial'
            animate='visible'
            exit='exit'
            transition={errorTransition}>
            {props.error}
          </ErrorText>
        ) : null}
      </AnimatePresence>
    </StyledContainer>
  )
}
