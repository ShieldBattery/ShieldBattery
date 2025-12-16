import * as React from 'react'
import { useEffect, useRef } from 'react'
import styled, { css } from 'styled-components'
import { singleLine } from '../../styles/typography'
import { useButtonState } from '../button'
import { buttonReset } from '../button-reset'
import { Ripple } from '../ripple'
import { ITEM_HEIGHT, ITEM_HEIGHT_DENSE } from './menu'
import { BaseMenuItemProps, MenuItemSymbol, MenuItemType } from './menu-item-symbol'

const Item = styled.button<{ $dense?: boolean; $focused?: boolean }>`
  ${buttonReset};
  position: relative;
  width: auto;
  height: ${props => (props.$dense ? ITEM_HEIGHT_DENSE : ITEM_HEIGHT)}px;
  margin: 0 4px;
  padding: 0 8px;

  display: flex;
  align-items: center;
  flex-shrink: 0;

  border-radius: 4px;
  text-align: left;

  ${props => {
    if (!props.$focused) {
      return ''
    }

    // NOTE(2Pac): This styling is only applied if the menu item is virtually focused. For regularly
    // focused items, the focus styling is applied through the button (:focus-visible pseudo class)
    // and ripple.
    return css`
      background-color: rgb(from var(--theme-on-surface) r g b / 0.1);
      outline: 3px solid var(--theme-grey-blue);
      outline-offset: 2px;
    `
  }}

  &:disabled,
  &[disabled] {
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
    pointer-events: none;
  }
`

const ItemText = styled.div`
  ${singleLine};
  flex-grow: 1;
`

const ItemIcon = styled.span`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  width: 24px;
  margin-right: 12px;
  overflow: hidden;
`

export interface MenuItemProps extends BaseMenuItemProps {
  icon?: React.ReactNode
  /**
   * If true, the focused state only affects visual styling without moving actual DOM focus.
   * This is useful when you want to maintain focus elsewhere (e.g. in an input field) while
   * still showing keyboard navigation in the menu.
   */
  virtualFocus?: boolean
}

export function MenuItem({
  text,
  icon,
  dense,
  focused,
  disabled,
  trailingContent,
  onClick,
  onKeyDown,
  className,
  testName,
  virtualFocus,
}: MenuItemProps) {
  const [buttonProps, rippleRef] = useButtonState({ onClick, onKeyDown, disabled })
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!virtualFocus) {
      if (focused) {
        buttonRef.current?.focus()
      } else {
        buttonRef.current?.blur()
      }
    }
  }, [focused, virtualFocus])

  return (
    <Item
      ref={buttonRef}
      className={className}
      data-test={testName}
      {...buttonProps}
      $dense={dense}
      $focused={focused && virtualFocus}>
      {icon ? <ItemIcon>{icon}</ItemIcon> : null}
      <ItemText>{text}</ItemText>
      {trailingContent}
      <Ripple ref={rippleRef} />
    </Item>
  )
}

MenuItem[MenuItemSymbol] = MenuItemType.Default

export const DestructiveMenuItem = styled(MenuItem)`
  color: var(--theme-negative);
`
