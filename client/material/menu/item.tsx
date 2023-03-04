import React, { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { colorError } from '../../styles/colors'
import { singleLine } from '../../styles/typography'
import { useButtonState } from '../button'
import { buttonReset } from '../button-reset'
import { Ripple } from '../ripple'
import { ITEM_HEIGHT, ITEM_HEIGHT_DENSE } from './menu'
import { MenuItemSymbol, MenuItemType } from './menu-item-symbol'

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

  border-radius: 2px;
  text-align: left;
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

export interface MenuItemProps {
  text: string
  className?: string
  icon?: React.ReactNode
  focused?: boolean
  dense?: boolean
  onClick?: (event: React.MouseEvent) => void
}

export function MenuItem({ text, icon, dense, focused, onClick, className }: MenuItemProps) {
  const [buttonProps, rippleRef] = useButtonState({ onClick })
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (focused) {
      buttonRef.current?.focus()
    } else {
      buttonRef.current?.blur()
    }
  }, [focused])

  return (
    <Item ref={buttonRef} className={className} $dense={dense} {...buttonProps}>
      {icon ? <ItemIcon>{icon}</ItemIcon> : null}
      <ItemText>{text}</ItemText>
      <Ripple ref={rippleRef} />
    </Item>
  )
}

MenuItem[MenuItemSymbol] = MenuItemType.Default

export const DestructiveMenuItem = styled(MenuItem)`
  color: ${colorError};
`
