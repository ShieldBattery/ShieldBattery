import * as React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { useMultiplexRef } from '../react/refs'
import { labelLarge } from '../styles/typography'
import { useButtonState } from './button'
import { buttonReset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { MenuList } from './menu/menu'
import { isMenuItem } from './menu/menu-item-symbol'
import { Popover, usePopoverController, useRefAnchorPosition } from './popover'
import { Ripple } from './ripple'

const ICON_SIZE = 18

const FilterChipRoot = styled.button<{
  $highlighted: boolean
  $hasLeadingIcon: boolean
  $hasTrailingIcon: boolean
}>`
  ${buttonReset};
  ${fastOutSlowInShort};

  height: 32px;
  padding-left: ${props => (props.$hasLeadingIcon ? '8px' : '16px')};
  padding-right: ${props => (props.$hasTrailingIcon ? '8px' : '16px')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  border-radius: 8px;
  contain: content;

  background-color: ${props =>
    props.$highlighted ? 'rgb(from var(--theme-primary) r g b / 0.16)' : 'transparent'};
  border: 1px solid
    ${props =>
      props.$highlighted ? 'rgb(from var(--theme-primary) r g b / 0.5)' : 'var(--theme-outline)'};
  color: ${props => (props.$highlighted ? 'var(--color-blue80)' : 'var(--theme-on-surface)')};
  outline-color: var(--theme-grey-blue);

  --sb-ripple-color: ${props =>
    props.$highlighted ? 'var(--theme-primary)' : 'var(--theme-on-surface)'};

  &:hover {
    background-color: ${props =>
      props.$highlighted
        ? 'rgb(from var(--theme-primary) r g b / 0.24)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.08)'};
  }

  &:disabled,
  &[disabled] {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.04);
    border-color: rgb(from var(--theme-on-surface) r g b / 0.12);
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
    pointer-events: none;
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

const ChipLabel = styled.span`
  ${labelLarge};
  white-space: nowrap;
`

const IconContainer = styled.span`
  width: ${ICON_SIZE}px;
  height: ${ICON_SIZE}px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const DropdownIcon = styled(MaterialIcon)<{ $open: boolean }>`
  ${fastOutSlowInShort};
  transform: rotate(${props => (props.$open ? 180 : 0)}deg);
`

const StyledMenuList = styled(MenuList)`
  --sb-menu-min-width: 112px;
`

export interface FilterChipProps {
  /** The text label displayed on the chip. */
  label: string
  /** Whether the chip is selected. */
  selected?: boolean
  /** Whether the chip is disabled. */
  disabled?: boolean
  /**
   * An optional icon to display at the start of the chip. If `selected` is true and no icon is
   * provided, a checkmark icon will be shown.
   */
  icon?: React.ReactNode
  /**
   * Callback when the chip is clicked. Not really useful when `children` (menu items) are provided,
   * since the chip will open the menu on click in that case.
   */
  onClick?: (event: React.MouseEvent) => void
  /**
   * Optional menu items to show in a dropdown. When provided, the chip will show a dropdown
   * arrow and open a menu when clicked. Use `SelectableMenuItem` components as children.
   */
  children?: React.ReactNode
  className?: string
  testName?: string
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * A Material Design 3 filter chip. Filter chips use tags or descriptive words to filter content.
 * They can be selected or unselected, and can optionally display an icon.
 *
 * When `children` (menu items) are provided, the chip will show a dropdown arrow and open a
 * menu when clicked, allowing selection from multiple options.
 */
export function FilterChip({
  label,
  selected = false,
  icon,
  className,
  disabled,
  onClick,
  children,
  testName,
  ref,
}: FilterChipProps) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'left',
    'bottom',
  )
  const [open, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })

  const composedRef = useMultiplexRef(ref, anchorRef)

  const menuItems = React.Children.toArray(children).filter(child => isMenuItem(child))
  const hasMenu = menuItems.length > 0

  const [buttonProps, rippleRef] = useButtonState({
    disabled,
    onClick: (event: React.MouseEvent) => {
      if (hasMenu) {
        if (open) {
          closePopover()
        } else {
          openPopover(event)
        }
      }
      onClick?.(event)
    },
  })

  const clonedMenuItems = menuItems.map((item, index) => {
    return React.cloneElement(item, {
      key: index,
      onClick: event => {
        item.props.onClick?.(event)
        closePopover()
      },
    })
  })

  const showLeadingIcon = selected || icon
  const leadingIcon = selected && !icon ? <MaterialIcon icon='check' size={ICON_SIZE} /> : icon
  const isHighlighted = selected || (hasMenu && open)

  return (
    <>
      <FilterChipRoot
        ref={composedRef}
        className={className}
        $highlighted={isHighlighted}
        $hasLeadingIcon={!!showLeadingIcon}
        $hasTrailingIcon={hasMenu}
        data-test={testName}
        {...buttonProps}>
        {showLeadingIcon ? <IconContainer>{leadingIcon}</IconContainer> : null}
        <ChipLabel>{label}</ChipLabel>
        {hasMenu ? <DropdownIcon icon='arrow_drop_down' size={ICON_SIZE} $open={open} /> : null}
        <Ripple ref={rippleRef} disabled={disabled} />
      </FilterChipRoot>

      {hasMenu ? (
        <Popover
          open={open}
          onDismiss={() => {
            closePopover()
          }}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX='left'
          originY='top'>
          <StyledMenuList dense={true}>{clonedMenuItems}</StyledMenuList>
        </Popover>
      ) : null}
    </>
  )
}
