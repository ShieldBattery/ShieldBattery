import { Variants } from 'motion/react'
import React, { useCallback, useId, useState } from 'react'
import styled, { css } from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { useKeyListener } from '../../keyboard/key-listener'
import { assignRef } from '../../react/refs'
import { useValueAsRef } from '../../react/state-hooks'
import { buttonReset } from '../button-reset'
import { standardEasing } from '../curve-constants'
import { InputBase } from '../input-base'
import { InputError } from '../input-error'
import { FloatingLabel } from '../input-floating-label'
import { InputUnderline } from '../input-underline'
import { MenuList } from '../menu/menu'
import { isSelectableMenuItem } from '../menu/menu-item-symbol'
import { Popover, useAnchorPosition, usePopoverController } from '../popover'
import { SelectOptionProps } from './option'

const SPACE = 'Space'
const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const SelectContainer = styled.button<{
  $disabled?: boolean
  $focused?: boolean
  $dense?: boolean
}>`
  ${buttonReset};
  position: relative;
  width: 100%;
  height: ${props => (props.$dense ? '40px' : '56px')};
  padding: 0;

  display: flex;
  flex-direction: column;
  align-items: flex-start;

  contain: layout paint style;

  background-color: ${props =>
    props.$disabled
      ? 'rgb(from var(--theme-on-surface) r g b / calc(1 / var(--theme-disabled-opacity) * 0.04))'
      : 'var(--theme-container-highest)'};
  border-radius: 4px 4px 0 0;
  font-size: 16px;
  line-height: 20px;
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};

  cursor: pointer;
  pointer-events: ${props => (props.$disabled ? 'none' : 'unset')};

  &:focus {
    outline: none;
  }
`

const StateLayer = styled.div<{ $opened?: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-color: var(--theme-on-surface);
  opacity: 0;
  transition: opacity 75ms linear;

  *:hover > & {
    opacity: 0.08;
  }

  *:focus-within > & {
    opacity: 0.12;
  }

  ${props =>
    props.$opened
      ? css`
          && {
            opacity: 0.12;
          }
        `
      : css``}
`

const DisplayValue = styled(InputBase)`
  display: flex;
  align-items: center;
`

const Icon = styled.span<{
  $disabled?: boolean
  $focused?: boolean
  $opened?: boolean
  $dense?: boolean
}>`
  position: absolute;
  top: 50%;
  right: ${props => (props.$dense ? '8px' : '12px')};
  width: 24px;
  height: 24px;
  margin-left: 4px;
  pointer-events: none;
  transform: translate3d(0, -50%, 0) ${props => (props.$opened ? 'rotate(180deg)' : '')};
  transition:
    transform 150ms ${standardEasing},
    color 75ms linear;

  color: ${props => {
    if (props.$disabled) return 'rgb(from var(--theme-on-surface) r g b / 0.38)'
    else if (props.$focused) return 'var(--theme-amber)'
    else return 'var(--theme-on-surface)'
  }};

  & > svg {
    width: 24px;
    height: 24px;
  }
`

const StyledMenuList = styled(MenuList)<{ $overlayWidth: number }>`
  width: ${props => props.$overlayWidth}px;
  background-color: var(--theme-container);
`

export interface SelectProps {
  /**
   * Selectable options to display.
   * @see ./option.tsx
   */
  children: React.ReactNode
  /**
   * The current value of the input. Will be matched against the children's values using
   * `compareValues`.
   */
  value: unknown
  /**
   * An optional class string to apply to the root element.
   */
  className?: string
  /**
   * An optional id to use for the interactable element.
   */
  id?: string
  /**
   * Whether or not errors are possible. If they are not possible, no error text will ever be
   * shown and no space will be reserved for it next to the input. Defaults to `true`.
   */
  allowErrors?: boolean
  /**
   * Error text to show (`allowErrors` must be true for this to work).
   */
  errorText?: string
  /** Whether the input should be styled in a more compact way (defaults to false). */
  dense?: boolean
  /**
   * A label to include with the input, specifying what the input is for to users.
   */
  label?: string
  /** Whether or not the Select is currently reacting to user input. */
  disabled?: boolean
  /** Value to use for the `tabindex` form attribute. */
  tabIndex?: number
  /**
   * Callback whenever the current value of the input has changed.
   */
  onChange: (value: any) => void
  /**
   * Called to compare two input values. Optional, defaults to `Object.is`.
   */
  compareValues?: (a: any, b: any) => boolean
  ref?: React.Ref<HTMLButtonElement | null>
}

const menuVariants: Variants = {
  entering: { opacity: 0, scaleY: 0.5 },
  visible: { opacity: 1, scaleY: 1 },
  exiting: { opacity: 0, scaleY: 0 },
}

const menuTransition = {
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
  scaleY: { type: 'spring', duration: 0.4 },
}

export function Select({
  children,
  value,
  className,
  allowErrors = true,
  errorText,
  dense = false,
  label,
  disabled,
  tabIndex,
  onChange,
  compareValues = Object.is,
  id: propsId,
  ref,
}: SelectProps) {
  const hookId = useId()
  const id = propsId ?? hookId
  const [focused, setFocused] = useState(false)
  const [inputElem, setInputElem] = useState<HTMLButtonElement | null>(null)

  const [opened, openSelect, closeSelect] = usePopoverController()
  const [anchorRef, anchorX, anchorY] = useAnchorPosition('center', 'bottom')

  const focusedRef = useValueAsRef(focused)
  const openedRef = useValueAsRef(opened)

  const onOpen = useCallback(
    (event: React.MouseEvent) => {
      if (!disabled) {
        openSelect(event)
      }
    },
    [disabled, openSelect],
  )
  const onClose = () => {
    closeSelect()
    inputElem?.focus()
  }
  const onFocus = () => {
    if (!disabled) {
      setFocused(true)
    }
  }
  const onBlur = () => {
    if (!openedRef.current) {
      // If we're opened, leave isFocused since we'll be reassigning focus on close
      setFocused(false)
    }
  }
  const onOptionChanged = (index: number) => {
    if (onChange) {
      const activeChild = React.Children.toArray(children)[index]
      onChange((activeChild as React.ReactElement<SelectOptionProps>).props.value)
    }
    onClose()
  }
  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (!focusedRef.current) return false

      if (!openedRef.current) {
        if (event.code === SPACE || event.code === ENTER || event.code === ENTER_NUMPAD) {
          openSelect(event)
          return true
        }
      }

      return false
    },
  })

  const options = React.Children.map(children, (_child, index) => {
    if (!isSelectableMenuItem(_child)) return _child

    const child = _child as React.ReactElement<SelectOptionProps>

    let selected = false
    if (value !== undefined && child.props.value !== undefined) {
      if (compareValues(value, child.props.value)) {
        selected = true
      }
    }

    return React.cloneElement(child, {
      selected,
      onClick: () => onOptionChanged(index),
    })
  })

  let displayValue: string | undefined
  React.Children.forEach(options, _child => {
    if (!isSelectableMenuItem(_child)) return

    const child = _child as React.ReactElement<SelectOptionProps>
    if (child.props.selected) {
      displayValue = child.props.text
    }
  })

  const overlayWidth = inputElem?.offsetWidth ?? 0

  return (
    <div className={className}>
      <SelectContainer
        ref={elem => {
          setInputElem(elem)
          anchorRef(elem)
          return assignRef(ref, elem)
        }}
        id={id}
        type='button'
        $disabled={disabled}
        $focused={focused}
        $dense={dense}
        tabIndex={disabled ? undefined : (tabIndex ?? 0)}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onOpen}>
        {label ? (
          <FloatingLabel
            htmlFor={id}
            $hasValue={value !== undefined}
            $dense={dense}
            $focused={focused}
            $disabled={disabled}
            $error={!!errorText}>
            {label}
          </FloatingLabel>
        ) : null}
        <DisplayValue as='span' $floatingLabel={!!label} $dense={dense}>
          {displayValue}
        </DisplayValue>
        <Icon $opened={opened} $focused={focused} $disabled={disabled} $dense={dense}>
          <MaterialIcon icon='arrow_drop_down' />
        </Icon>
        <InputUnderline focused={focused} error={!!errorText} />
        <StateLayer $opened={opened} />
      </SelectContainer>
      {allowErrors ? <InputError error={errorText} /> : null}
      <Popover
        open={opened}
        onDismiss={onClose}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='center'
        originY='top'
        motionVariants={menuVariants}
        motionInitial='entering'
        motionAnimate='visible'
        motionExit='exiting'
        motionTransition={menuTransition}>
        <StyledMenuList $overlayWidth={overlayWidth} dense={dense}>
          {options}
        </StyledMenuList>
      </Popover>
    </div>
  )
}
