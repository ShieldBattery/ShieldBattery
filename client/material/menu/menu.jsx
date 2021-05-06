import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import KeyListener from '../../keyboard/key-listener'
import { LegacyPopover } from '../legacy-popover'
import MenuItemSymbol from './menu-item-symbol'

import { fastOutSlowIn } from '../curve-constants'
import { shadowDef6dp } from '../shadow-constants'
import { zIndexMenu } from '../zindex'
import { CardLayer } from '../../styles/colors'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'
const TAB = 'Tab'
const ESCAPE = 'Escape'
const UP = 'ArrowUp'
const DOWN = 'ArrowDown'

export const ITEM_HEIGHT = 48
export const ITEM_HEIGHT_DENSE = 32
const VERT_PADDING = 8
const MENU_MIN_HEIGHT = 48
const MENU_MIN_HEIGHT_DENSE = 32
const ITEMS_SHOWN = 5
const ITEMS_SHOWN_DENSE = 8
// NOTE(tec27): We only add 1 instance of vertical padding here under the assumption that it is
// less than half the item height in all cases. This means we're either exceed the max height and
// have some items partially cut off, or we'll be within the max height and have padding visible
// on both sides.
const MENU_MAX_HEIGHT = ITEM_HEIGHT * (ITEMS_SHOWN + 0.5) + VERT_PADDING
const MENU_MAX_HEIGHT_DENSE = ITEM_HEIGHT_DENSE * (ITEMS_SHOWN_DENSE + 0.5) + VERT_PADDING

export const Overlay = styled(CardLayer)`
  min-width: 160px;
  min-height: ${props => (props.dense ? MENU_MIN_HEIGHT_DENSE : MENU_MIN_HEIGHT)}px;
  max-height: ${props => (props.dense ? MENU_MAX_HEIGHT_DENSE : MENU_MAX_HEIGHT)}px;
  box-shadow: ${shadowDef6dp};
  z-index: ${zIndexMenu};
  border-radius: 2px;
  contain: content;
  overflow-x: hidden;
  overflow-y: auto;

  &.enter {
    opacity: 0;
  }

  &.enterActive {
    opacity: 1;
    transition-property: opacity;
    transition-duration: ${props => props.transitionDuration}ms;
    transition-timing-function: ${fastOutSlowIn};
    transition-delay: ${props => props.transitionDelay}ms;
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition-property: opacity;
    transition-duration: ${props => props.transitionDuration}ms;
    transition-timing-function: ${fastOutSlowIn};
  }
`

// Create a component that serves as a padding before the first and after the last item in the menu,
// as opposed to declaring padding in container's CSS rules as that doesn't play nice with scrollbar
const Padding = styled.div`
  width: auto;
  height: 8px;
`

// A wrapper component around Popover that can be used to quickly write Menus
// TODO(2Pac): Menus should probably have some default positioning instead of exposing the
// lower-level API of the Popovers.
export default class Menu extends React.Component {
  static propTypes = {
    dense: PropTypes.bool,
    selectedIndex: PropTypes.number,
    // Use this function to implement a custom CSS transitions for opening/closing the menu. Will be
    // called with the menu content.
    renderTransition: PropTypes.func,
    onItemSelected: PropTypes.func,
  }

  static defaultProps = {
    selectedIndex: -1,
  }

  state = {
    activeIndex: this.props.selectedIndex,
  }

  _overlay = React.createRef()

  componentDidUpdate(prevProps) {
    if (prevProps.open && !this.props.open) {
      this.setState({ activeIndex: this.props.selectedIndex })
    }
    if (!prevProps.open && this._overlay.current) {
      // update the scroll position to the selected value
      const firstDisplayed = this._getFirstDisplayedItemIndex()
      this._overlay.current.scrollTop = firstDisplayed * ITEM_HEIGHT
    }
  }

  _getMenuItems() {
    return React.Children.toArray(this.props.children).filter(child => child.type[MenuItemSymbol])
  }

  _getFirstDisplayedItemIndex() {
    const { dense, selectedIndex } = this.props
    const numItems = this._getMenuItems().length
    const itemsShown = dense ? ITEMS_SHOWN_DENSE : ITEMS_SHOWN
    const lastVisibleIndex = itemsShown - 1
    if (selectedIndex <= lastVisibleIndex || numItems < itemsShown) {
      return 0
    }
    return Math.min(numItems - itemsShown, selectedIndex - lastVisibleIndex)
  }

  render() {
    const {
      children,
      dense,
      selectedIndex,
      renderTransition,
      onItemSelected, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...popoverProps
    } = this.props

    let i = 0
    const items = React.Children.map(children, child => {
      // Leave the non-selectable elements (e.g. dividers, overlines, etc.) as they are
      if (!child.type[MenuItemSymbol]) return child

      // Define a block-scoped variable which will bind to the `onItemSelected` closure below
      const index = i
      const elem = React.cloneElement(child, {
        dense,
        focused: index === this.state.activeIndex,
        selected: index === selectedIndex,
        onItemSelected: () => this.onItemSelected(index),
      })
      i++

      return elem
    })

    return (
      <LegacyPopover {...popoverProps}>
        {(state, timings) => {
          const { openDelay, openDuration, closeDuration } = timings
          let transitionDuration = 0
          let transitionDelay = 0
          if (state === 'opening') {
            transitionDuration = openDuration
            transitionDelay = openDelay
          } else if (state === 'opened') {
            transitionDuration = closeDuration
          }

          const content = (
            <>
              <Padding />
              {items}
              <Padding />
            </>
          )

          return (
            <>
              <KeyListener onKeyDown={this.onKeyDown} />
              {renderTransition ? (
                renderTransition(content)
              ) : (
                <CSSTransition
                  in={state === 'opening' || state === 'opened'}
                  classNames={transitionNames}
                  appear={true}
                  timeout={{ appear: openDuration, enter: openDuration, exit: closeDuration }}>
                  <Overlay
                    key='menu'
                    ref={this._overlay}
                    className={this.props.className}
                    dense={dense}
                    transitionDuration={transitionDuration}
                    transitionDelay={transitionDelay}>
                    {content}
                  </Overlay>
                </CSSTransition>
              )}
            </>
          )
        }}
      </LegacyPopover>
    )
  }

  _moveActiveIndexBy(delta) {
    const { dense } = this.props

    let newIndex = this.state.activeIndex
    if (newIndex === -1) {
      newIndex = this.props.selectedIndex
    }

    const numItems = this._getMenuItems().length
    newIndex += delta
    while (newIndex < 0) {
      newIndex += numItems
    }
    newIndex = newIndex % numItems

    if (newIndex !== this.state.activeIndex) {
      this.setState({
        activeIndex: newIndex,
      })
    }

    const itemHeight = dense ? ITEM_HEIGHT_DENSE : ITEM_HEIGHT
    const itemsShown = dense ? ITEMS_SHOWN_DENSE : ITEMS_SHOWN

    // Adjust scroll position to keep the item in view
    const curTopIndex = Math.ceil(
      Math.max(0, this._overlay.current.scrollTop - VERT_PADDING) / itemHeight,
    )
    const curBottomIndex = curTopIndex + itemsShown - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      this._overlay.current.scrollTop = itemHeight * newIndex
    } else {
      // Make the new index the bottom item
      this._overlay.current.scrollTop = itemHeight * (newIndex + 1 - itemsShown)
    }
  }

  onKeyDown = event => {
    if (event.code === ESCAPE) {
      this.props.onDismiss()
      return true
    } else if (event.code === UP) {
      this._moveActiveIndexBy(-1)
      return true
    } else if (event.code === DOWN) {
      this._moveActiveIndexBy(1)
      return true
    } else if (event.code === TAB) {
      if (this.state.activeIndex >= 0) {
        this.onItemSelected(this.state.activeIndex)
        return true
      }
    } else if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      if (this.state.activeIndex >= 0) {
        this.onItemSelected(this.state.activeIndex)
        return true
      }
    }

    return false
  }

  onItemSelected = index => {
    if (this.props.onItemSelected) {
      this.props.onItemSelected(index)
    }
  }
}
