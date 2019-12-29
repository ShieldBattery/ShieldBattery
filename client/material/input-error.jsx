import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition, TransitionGroup } from 'react-transition-group'
import styled from 'styled-components'

import { fastOutLinearIn, linearOutSlowIn } from '../material/curve-constants'
import { colorError } from '../styles/colors'

const StyledTransitionGroup = styled(TransitionGroup)`
  display: flex;
  align-items: center;
  order: 4;
  height: 20px;
  padding: 0 12px;
  pointer-events: none;
`

const ErrorText = styled.div`
  font-size: 12px;
  line-height: 20px;
  color: ${colorError};
  pointer-events: none;

  &.enter {
    opacity: 0.01;
    transform: translate3d(0, -30%, 0);
  }

  &.enterActive {
    opacity: 1;
    transform: translate3d(0, 0, 0);
    transition: all 250ms ${linearOutSlowIn};
  }

  &.exit {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }

  &.exitActive {
    opacity: 0.01;
    transform: translate3d(0, -30%, 0);
    transition: all 250ms ${fastOutLinearIn};
  }
`

const transitionNames = {
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const InputError = props => {
  // `CSSTransition` can't on its own animate an exit transition of text content (error text in our
  // case), because it gets immediately removed from the DOM when exit transition starts, even if
  // the node that holds those contents remain in DOM; i.e., when using only `CSSTransition`,
  // `ErrorText` div gets animated just fine on exit, but not its content, the text that we actually
  // want to animate. Technically, we could probably use the `addEndListener` property to keep the
  // text content in the DOM until the exit transition finishes, but that would be pretty hacky so
  // we wen't with the second option.
  // Second option is using the `TransitionGroup` component which can render `null` as its children
  // and it keeps the text content in the DOM until the exit transition finishes, animating the text
  // just as we want (`CSSTransition` can't have `null` as its children).
  return (
    <StyledTransitionGroup>
      {props.error ? (
        <CSSTransition key='error' classNames={transitionNames} timeout={250}>
          <ErrorText>{props.error}</ErrorText>
        </CSSTransition>
      ) : null}
    </StyledTransitionGroup>
  )
}

InputError.propTypes = {
  error: PropTypes.string,
}

export default InputError
