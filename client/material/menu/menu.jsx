import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import KeyListener from '../../keyboard/key-listener.jsx'
import Popover from '../popover.jsx'
import { ScrollableContent } from '../scroll-bar.jsx'
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
const TAB = 'Tab'
const ESCAPE = 'Escape'
const UP = 'ArrowUp'
const DOWN = 'ArrowDown'

const MENU_MIN_HEIGHT = 48
const MENU_MAX_HEIGHT = 256
const VERT_PADDING = 8
const ITEM_HEIGHT = 48
const ITEMS_SHOWN = (MENU_MAX_HEIGHT - VERT_PADDING * 2) / ITEM_HEIGHT

export const Overlay = styled(CardLayer)`
  min-width: 160px;
  min-height: ${MENU_MIN_HEIGHT}px;
  max-height: ${MENU_MAX_HEIGHT}px;
  box-shadow: ${shadowDef6dp};
  z-index: ${zIndexMenu};
  border-radius: 2px;

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
// lower-level API of the Popovers. But until that can be done, Popovers needs to add support for
// dynamic positioning, i.e. adjust the positioning automatically if they go outside the viewport.
export default class Menu extends React.Component {
  static propTypes = {
    ...Popover.propTypes,
    children: PropTypes.array,
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
      this._overlay.current.scrollTop(firstDisplayed * ITEM_HEIGHT)
    }
  }

  _getMenuItems() {
    return React.Children.toArray(this.props.children).filter(child => child.type[MenuItemSymbol])
  }

  _getFirstDisplayedItemIndex() {
    const { selectedIndex } = this.props
    const numItems = this._getMenuItems().length
    const lastVisibleIndex = ITEMS_SHOWN - 1
    if (selectedIndex <= lastVisibleIndex || numItems < ITEMS_SHOWN) {
      return 0
    }
    return Math.min(numItems - ITEMS_SHOWN, selectedIndex - lastVisibleIndex)
  }

  render() {
    const {
      children,
      selectedIndex,
      renderTransition,
      onItemSelected, // eslint-disable-line no-unused-vars
      ...popoverProps
    } = this.props

    let i = 0
    const items = React.Children.map(children, child => {
      // Leave the non-selectable elements (e.g. dividers, overlines, etc.) as they are
      if (!child.type[MenuItemSymbol]) return child

      // Define a block-scoped variable which will bind to the `onItemSelected` closure below
      const index = i
      const elem = React.cloneElement(child, {
        focused: index === this.state.activeIndex,
        selected: index === selectedIndex,
        onItemSelected: () => this.onItemSelected(index),
      })
      i++

      return elem
    })

    return (
      <Popover {...popoverProps}>
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
            <ScrollableContent
              ref={this._overlay}
              autoHeight={true}
              autoHeightMin={MENU_MIN_HEIGHT}
              autoHeightMax={MENU_MAX_HEIGHT}>
              <Padding />
              {items}
              <Padding />
            </ScrollableContent>
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
                    className={this.props.className}
                    transitionDuration={transitionDuration}
                    transitionDelay={transitionDelay}>
                    {content}
                  </Overlay>
                </CSSTransition>
              )}
            </>
          )
        }}
      </Popover>
    )
  }

  _moveActiveIndexBy(delta) {
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

    // Adjust scroll position to keep the item in view
    const curTopIndex = Math.ceil(
      Math.max(0, this._overlay.current.getScrollTop() - VERT_PADDING) / ITEM_HEIGHT,
    )
    const curBottomIndex = curTopIndex + ITEMS_SHOWN - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      this._overlay.current.scrollTop(ITEM_HEIGHT * newIndex)
    } else {
      // Make the new index the bottom item
      this._overlay.current.scrollTop(ITEM_HEIGHT * (newIndex + 1 - ITEMS_SHOWN))
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
    } else if (event.code === ENTER) {
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
