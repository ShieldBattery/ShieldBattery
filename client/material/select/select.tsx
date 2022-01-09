import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { UseTransitionProps } from 'react-spring'
import styled from 'styled-components'
import { useId } from '../../dom/unique-id'
import ArrowDropDownIcon from '../../icons/material/ic_arrow_drop_down_black_24px.svg'
import KeyListener from '../../keyboard/key-listener'
import { useValueAsRef } from '../../state-hooks'
import { amberA400, background300, colorTextFaint, colorTextPrimary } from '../../styles/colors'
import { buttonReset } from '../button-reset'
import { fastOutSlowIn } from '../curve-constants'
import InputBase from '../input-base'
import InputError from '../input-error'
import FloatingLabel from '../input-floating-label'
import InputUnderline from '../input-underline'
import { Menu } from '../menu/menu'
import { useAnchorPosition } from '../popover'
import { defaultSpring } from '../springs'

const SPACE = 'Space'
const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const CONTAINER_HEIGHT = 56

const SelectContainer = styled.button<{ disabled?: boolean; $focused?: boolean }>`
  ${buttonReset};
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  width: 100%;
  height: ${CONTAINER_HEIGHT}px;
  padding: 0;
  cursor: ${props => (props.disabled ? 'default' : 'pointer')};
  font-size: 16px;
  line-height: 20px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px 4px 0 0;
  contain: layout paint style;
  transition: background-color 150ms linear;

  &:focus {
    outline: none;
  }

  ${props =>
    !props.disabled
      ? `
        &:hover {
          background-color: rgba(255, 255, 255, 0.12);
        }
      `
      : ''}

  ${props =>
    props.$focused
      ? `
        background-color: rgba(255, 255, 255, 0.16) !important;
      `
      : ''}
`

const DisplayValue = styled(InputBase)`
  display: flex;
  align-items: center;
`

const Icon = styled.span<{ $disabled?: boolean; $focused?: boolean; $opened?: boolean }>`
  position: absolute;
  top: 50%;
  right: 12px;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  pointer-events: none;
  transform: translate3d(0, -50%, 0) ${props => (props.$opened ? 'rotate(180deg)' : '')};
  transition: transform 150ms ${fastOutSlowIn};

  & > svg {
    width: 24px;
    height: 24px;
    ${props => {
      let color
      if (props.$disabled) {
        color = colorTextFaint
      } else if (props.$focused) {
        color = amberA400
      } else {
        color = colorTextPrimary
      }

      return `color: ${color}`
    }};
  }
`

const StyledMenu = styled(Menu)<{ $overlayWidth: number }>`
  width: ${props => props.$overlayWidth}px;
  background-color: ${background300};
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
   * Whether or not errors are possible. If they are not possible, no error text will ever be
   * shown and no space will be reserved for it next to the input. Defaults to `true`.
   */
  allowErrors?: boolean
  /**
   * Error text to show (`allowErrors` must be true for this to work).
   */
  errorText?: string
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
}

export interface SelectRef {
  /** Focuses the Select. */
  focus: () => void
  /** Unfocuses the Select. */
  blur: () => void
}

const MENU_TRANSITION: UseTransitionProps<boolean> = {
  from: { opacity: 0, scaleY: 0.5 },
  enter: { opacity: 1, scaleY: 1 },
  leave: { opacity: 0, scaleY: 0 },
  config: (item, index, phase) => key =>
    phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
}

export const Select = React.forwardRef<SelectRef, SelectProps>(
  (
    {
      children,
      value,
      className,
      allowErrors = true,
      errorText,
      label,
      disabled,
      tabIndex,
      onChange,
      compareValues = Object.is,
    },
    forwardedRef,
  ) => {
    const id = useId()
    const [focused, setFocused] = useState(false)
    const [opened, setOpened] = useState(false)
    const inputRef = useRef<HTMLButtonElement>()
    const [anchorRef, anchorX, anchorY] = useAnchorPosition('center', 'bottom')

    useImperativeHandle(forwardedRef, () => ({
      focus() {
        inputRef.current?.focus()
      },

      blur() {
        inputRef.current?.blur()
      },
    }))

    const focusedRef = useValueAsRef(focused)
    const openedRef = useValueAsRef(opened)

    const onOpen = useCallback(() => {
      if (!disabled) {
        setOpened(true)
      }
    }, [disabled])
    const onClose = useCallback(() => {
      setOpened(false)
      inputRef.current?.focus()
    }, [])
    const onFocus = useCallback(() => {
      if (!disabled) {
        setFocused(true)
      }
    }, [disabled])
    const onBlur = useCallback(() => {
      if (!openedRef.current) {
        // If we're opened, leave isFocused since we'll be reassigning focus on close
        setFocused(false)
      }
    }, [openedRef])
    const onOptionChanged = useCallback(
      (index: number) => {
        if (onChange) {
          const activeChild = React.Children.toArray(children)[index]
          onChange((activeChild as React.ReactElement).props.value)
        }
        onClose()
      },
      [onChange, onClose, children],
    )
    const onKeyDown = useCallback(
      (event: KeyboardEvent) => {
        if (!focusedRef.current) return false

        if (!openedRef.current) {
          if (event.code === SPACE || event.code === ENTER || event.code === ENTER_NUMPAD) {
            onOpen()
            return true
          }
        }

        return false
      },
      [focusedRef, openedRef, onOpen],
    )

    const multiplexRefs = useCallback(
      (elem: HTMLButtonElement | null) => {
        inputRef.current = elem !== null ? elem : undefined
        anchorRef(elem)
      },
      [anchorRef],
    )

    const [displayValue, selectedIndex] = useMemo(() => {
      if (value === undefined) {
        return [undefined, undefined]
      }

      const childrenArray = React.Children.toArray(children) as React.ReactElement[]
      let i = 0
      for (const child of childrenArray) {
        if (value !== undefined && child.props.value !== undefined) {
          if (compareValues(value, child.props.value)) {
            return [child.props.text, i]
          }
        }

        i++
      }

      return [undefined, undefined]
    }, [value, compareValues, children])

    const overlayWidth = inputRef.current?.offsetWidth ?? 0

    return (
      <div className={className}>
        <KeyListener onKeyDown={onKeyDown} />
        <SelectContainer
          ref={multiplexRefs}
          id={id}
          type='button'
          disabled={disabled}
          $focused={focused}
          tabIndex={disabled ? undefined : tabIndex ?? 0}
          onFocus={onFocus}
          onBlur={onBlur}
          onClick={onOpen}>
          {label ? (
            <FloatingLabel
              htmlFor={id}
              hasValue={value !== undefined}
              focused={focused}
              disabled={disabled}
              error={!!errorText}>
              {label}
            </FloatingLabel>
          ) : null}
          <DisplayValue as='span' floatingLabel={!!label} disabled={disabled}>
            {displayValue}
          </DisplayValue>
          <Icon $opened={opened} $focused={focused} $disabled={disabled}>
            <ArrowDropDownIcon />
          </Icon>
          <InputUnderline focused={focused} error={!!errorText} disabled={disabled} />
        </SelectContainer>
        {allowErrors ? <InputError error={errorText} /> : null}
        <StyledMenu
          $overlayWidth={overlayWidth}
          open={opened}
          onDismiss={onClose}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX='center'
          originY='top'
          selectedIndex={selectedIndex ?? -1}
          onItemSelected={onOptionChanged}
          transitionProps={MENU_TRANSITION}>
          {children}
        </StyledMenu>
      </div>
    )
  },
)
