import React, { useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { useKeyListener } from '../../keyboard/key-listener'
import { useStableCallback } from '../../state-hooks'
import { CardLayer } from '../../styles/colors'
import { body1, subtitle1 } from '../../styles/typography'
import { zIndexMenu } from '../zindex'
import { isMenuItem } from './menu-item-symbol'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'
const SPACE = 'Space'
const UP = 'ArrowUp'
const DOWN = 'ArrowDown'

export const ITEM_HEIGHT = 48
export const ITEM_HEIGHT_DENSE = 32
const VERT_PADDING = 8
const MENU_MIN_HEIGHT = 48
const MENU_MIN_HEIGHT_DENSE = 32
const ITEMS_SHOWN = 7
const ITEMS_SHOWN_DENSE = 11
// NOTE(tec27): We only add 1 instance of vertical padding here under the assumption that it is
// less than half the item height in all cases. This means we're either exceed the max height and
// have some items partially cut off, or we'll be within the max height and have padding visible
// on both sides.
const MENU_MAX_HEIGHT = ITEM_HEIGHT * (ITEMS_SHOWN + 0.5) + VERT_PADDING
const MENU_MAX_HEIGHT_DENSE = ITEM_HEIGHT_DENSE * (ITEMS_SHOWN_DENSE + 0.5) + VERT_PADDING

export const Overlay = styled(CardLayer)<{ $dense?: boolean }>`
  ${props => (props.$dense ? body1 : subtitle1)};

  --sb-menu-min-width: 160px;

  min-width: var(--sb-menu-min-width);
  min-height: ${props => (props.$dense ? MENU_MIN_HEIGHT_DENSE : MENU_MIN_HEIGHT)}px;
  max-height: ${props => (props.$dense ? MENU_MAX_HEIGHT_DENSE : MENU_MAX_HEIGHT)}px;

  display: flex;
  flex-direction: column;

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
  flex-shrink: 0;
`

export interface MenuListProps {
  children: React.ReactNode
  className?: string
  dense?: boolean
}

/**
 * A material design menu component with support for dense menu items and keyboard handling.
 *
 * Note that this component just renders the menu content, it doesn't render the popover part. The
 * reason for this separation is so we can create menus that run certain hooks (e.g. connect to the
 * store) which will be rendered only when the popover is open.
 */
export function MenuList({ children, className, dense }: MenuListProps) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const overlayRef = useRef<HTMLDivElement>(null)

  const menuItems = useMemo(() => {
    return React.Children.toArray(children).filter(child => isMenuItem(child))
  }, [children])

  const moveActiveIndexBy = useStableCallback((delta: number) => {
    if (!overlayRef.current || menuItems.length < 1) {
      return
    }

    let newIndex = activeIndex + delta
    if (newIndex < 0) {
      newIndex = menuItems.length - 1
    }
    newIndex = newIndex % menuItems.length

    if (newIndex !== activeIndex) {
      setActiveIndex(newIndex)
    }

    const itemHeight = dense ? ITEM_HEIGHT_DENSE : ITEM_HEIGHT
    const itemsShown = dense ? ITEMS_SHOWN_DENSE : ITEMS_SHOWN

    // Adjust scroll position to keep the item in view
    // TODO(2Pac): This doesn't really work correctly if the Menu has non-menu-items in it (e.g.
    // overlines, dividers, etc.)
    const curTopIndex = Math.ceil(
      Math.max(0, overlayRef.current.scrollTop - VERT_PADDING) / itemHeight,
    )
    const curBottomIndex = curTopIndex + itemsShown - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      overlayRef.current.scrollTop = itemHeight * newIndex
    } else {
      // Make the new index the bottom item
      overlayRef.current.scrollTop = itemHeight * (newIndex + 1 - itemsShown)
    }
  })

  useKeyListener({
    onKeyDown: useStableCallback(event => {
      if (event.code === UP) {
        moveActiveIndexBy(-1)
        return true
      } else if (event.code === DOWN) {
        moveActiveIndexBy(1)
        return true
      } else if (event.code === ENTER || event.code === ENTER_NUMPAD || event.code === SPACE) {
        const activeItem = menuItems[activeIndex]
        if (isMenuItem(activeItem)) {
          activeItem.props.onClick()
        }
      }

      return false
    }),
  })

  // We're using this variable as an index for only the menu items, so we don't try focusing a
  // non-menu-item (e.g. overline, divider, etc.)
  let i = 0
  const items = React.Children.map(children, child => {
    // Leave the non-selectable elements (e.g. dividers, overlines, etc.) as they are
    if (!isMenuItem(child)) return child

    const index = i
    const elem = React.cloneElement(child, {
      dense,
      focused: index === activeIndex,
    })
    i++

    return elem
  })

  return (
    <Overlay key='menu' ref={overlayRef} className={className} $dense={dense}>
      <Padding />
      {items}
      <Padding />
    </Overlay>
  )
}
