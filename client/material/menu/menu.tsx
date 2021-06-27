import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import KeyListener from '../../keyboard/key-listener'
import { CardLayer } from '../../styles/colors'
import { Popover, PopoverProps } from '../popover'
import { zIndexMenu } from '../zindex'
import { isMenuItem } from './menu-item-symbol'

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

export const Overlay = styled(CardLayer)<{ $dense?: boolean }>`
  min-width: 160px;
  min-height: ${props => (props.$dense ? MENU_MIN_HEIGHT_DENSE : MENU_MIN_HEIGHT)}px;
  max-height: ${props => (props.$dense ? MENU_MAX_HEIGHT_DENSE : MENU_MAX_HEIGHT)}px;
  z-index: ${zIndexMenu};
  border-radius: 2px;
  contain: content;
  overflow-x: hidden;
  overflow-y: auto;
`

// Create a component that serves as a padding before the first and after the last item in the menu,
// as opposed to declaring padding in container's CSS rules as that doesn't play nice with scrollbar
const Padding = styled.div`
  width: auto;
  height: 8px;
`

export interface MenuProps extends PopoverProps {
  selectedIndex?: number
  dense?: boolean
  onItemSelected?: (index: number) => void
}

interface MenuState {
  activeIndex: number
}

// A wrapper component around Popover that can be used to quickly write Menus
// TODO(2Pac): Menus should probably have some default positioning instead of exposing the
// lower-level API of the Popovers.
export default class Menu extends React.Component<MenuProps, MenuState> {
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

  override state = {
    activeIndex: this.props.selectedIndex!,
  }

  private overlay = React.createRef<HTMLDivElement>()

  override componentDidUpdate(prevProps: MenuProps) {
    if (prevProps.open && !this.props.open) {
      this.setState({ activeIndex: this.props.selectedIndex! })
    }
    if (!prevProps.open && this.overlay.current) {
      // update the scroll position to the selected value
      const firstDisplayed = this.getFirstDisplayedItemIndex()
      this.overlay.current.scrollTop = firstDisplayed * ITEM_HEIGHT
    }
  }

  private getMenuItems() {
    return React.Children.toArray(this.props.children).filter(child => isMenuItem(child))
  }

  private getFirstDisplayedItemIndex() {
    const { dense, selectedIndex } = this.props
    const numItems = this.getMenuItems().length
    const itemsShown = dense ? ITEMS_SHOWN_DENSE : ITEMS_SHOWN
    const lastVisibleIndex = itemsShown - 1
    if (selectedIndex! <= lastVisibleIndex || numItems < itemsShown) {
      return 0
    }
    return Math.min(numItems - itemsShown, selectedIndex! - lastVisibleIndex)
  }

  override render() {
    const {
      children,
      dense,
      selectedIndex,
      onItemSelected, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...popoverProps
    } = this.props

    let i = 0
    const items = React.Children.map(children, child => {
      // Leave the non-selectable elements (e.g. dividers, overlines, etc.) as they are
      if (!isMenuItem(child)) return child

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
      <Popover {...popoverProps}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <Overlay key='menu' ref={this.overlay} className={this.props.className} $dense={dense}>
          <Padding />
          {items}
          <Padding />
        </Overlay>
      </Popover>
    )
  }

  private moveActiveIndexBy(delta: number) {
    const { dense } = this.props

    let newIndex = this.state.activeIndex
    if (newIndex === -1) {
      newIndex = this.props.selectedIndex!
    }

    const numItems = this.getMenuItems().length
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
      Math.max(0, this.overlay.current!.scrollTop - VERT_PADDING) / itemHeight,
    )
    const curBottomIndex = curTopIndex + itemsShown - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      this.overlay.current!.scrollTop = itemHeight * newIndex
    } else {
      // Make the new index the bottom item
      this.overlay.current!.scrollTop = itemHeight * (newIndex + 1 - itemsShown)
    }
  }

  onKeyDown = (event: KeyboardEvent) => {
    if (event.code === ESCAPE) {
      this.props.onDismiss()
      return true
    } else if (event.code === UP) {
      this.moveActiveIndexBy(-1)
      return true
    } else if (event.code === DOWN) {
      this.moveActiveIndexBy(1)
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

  onItemSelected = (index: number) => {
    if (this.props.onItemSelected) {
      this.props.onItemSelected(index)
    }
  }
}
