import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import { ScrollableContent } from '../scroll-bar.jsx'

import { grey800 } from '../../styles/colors'
import { fastOutSlowIn, fastOutLinearIn, linearOutSlowIn } from '../curve-constants'
import { shadowDef8dp } from '../shadow-constants'
import { shadow8dp } from '../shadows'
import { zIndexMenu } from '../zindex'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const MENU_MIN_HEIGHT = 48
const MENU_MAX_HEIGHT = 256

const Overlay = styled.div`
  ${shadow8dp};
  position: fixed;
  min-height: ${MENU_MIN_HEIGHT}px;
  max-height: ${MENU_MAX_HEIGHT}px;
  z-index: ${zIndexMenu};
  background-color: ${grey800};
  transform-origin: center top;

  &.enter {
    opacity: 0;
    transform: scale(0.95, 0.8);
    box-shadow: none;
  }

  &.enterActive {
    opacity: 1;
    box-shadow: ${shadowDef8dp};
    transform: scale(1, 1);
    transition: transform 120ms ${fastOutSlowIn}, opacity 30ms ${linearOutSlowIn},
      box-shadow 30ms ${linearOutSlowIn};
  }

  &.exit {
    pointer-events: none;
    opacity: 1;
    transform: scale(1, 1);
    box-shadow: ${shadowDef8dp};
  }

  &.exitActive {
    opacity: 0;
    transform: scale(0.95, 0.9);
    box-shadow: none;
    transition: transform 120ms ${fastOutSlowIn}, opacity 50ms ${fastOutLinearIn} 50ms,
      box-shadow 30ms ${fastOutLinearIn};
  }
`

// Create a component that serves as a padding before the first and after the last item in the menu,
// as opposed to declaring padding in container's CSS rules as that doesn't play nice with scrollbar
const Padding = styled.div`
  width: auto;
  height: 8px;
`

const Menu = React.forwardRef((props, ref) => {
  const { open, overlayStyle } = props

  return (
    <CSSTransition in={open} classNames={transitionNames} appear={true} timeout={120}>
      <Overlay key='menu' style={overlayStyle}>
        <ScrollableContent
          ref={ref}
          autoHeight={true}
          autoHeightMin={MENU_MIN_HEIGHT}
          autoHeightMax={MENU_MAX_HEIGHT}>
          <Padding />
          {props.children}
          <Padding />
        </ScrollableContent>
      </Overlay>
    </CSSTransition>
  )
})

Menu.propTypes = {
  open: PropTypes.bool,
  overlayStyle: PropTypes.object,
}

export default Menu
