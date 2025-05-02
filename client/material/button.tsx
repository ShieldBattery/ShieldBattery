import React, { useCallback, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { useKeyListener } from '../keyboard/key-listener'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { labelLarge } from '../styles/typography'
import { buttonReset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { Ripple, RippleController } from './ripple'
import { elevationPlus1, elevationPlus2, elevationZero } from './shadows'

export const Label = styled.span`
  ${labelLarge};
  display: flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  white-space: nowrap;
`

export interface ButtonStateProps {
  disabled?: boolean
  onBlur?: (event: React.FocusEvent) => void
  onFocus?: (event: React.FocusEvent) => void
  onClick?: (event: React.MouseEvent) => void
  onDoubleClick?: (event: React.MouseEvent) => void
  onMouseDown?: (event: React.MouseEvent) => void
  onMouseEnter?: (event: React.MouseEvent) => void
  onMouseLeave?: (event: React.MouseEvent) => void
  onKeyDown?: (event: React.KeyboardEvent) => void
  onKeyUp?: (event: React.KeyboardEvent) => void
}

/**
 * Props that are included in the returned props of `useButtonState`. This can be used on a
 * styled-component to modify the style based on passed props.
 *
 * @example
 *
 * const CoolButton = styled.button<ButtonStateStyleProps>`
 *   background: ${props => props.$focused ? 'red' : 'blue'};
 * `
 */
export interface ButtonStateStyleProps {
  $focused: boolean
}

export interface ButtonStateAppliedProps extends ButtonStateStyleProps {
  disabled: boolean
  onBlur: (event: React.FocusEvent) => void
  onFocus: (event: React.FocusEvent) => void
  onClick: (event: React.MouseEvent) => void
  onDoubleClick?: (event: React.MouseEvent) => void
  onMouseDown: (event: React.MouseEvent) => void
  onMouseEnter: (event: React.MouseEvent) => void
  onMouseLeave: (event: React.MouseEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  onKeyUp: (event: React.KeyboardEvent) => void
}

type ButtonState = [
  /**
   * Props that should be set on the button being controlled. Includes a number of properties that
   * are useful only for styled-components (prepended with `$`). See `ButtonStateStyleProps` for a
   * type to reference.
   */
  buttonProps: ButtonStateAppliedProps,
  /** A ref to attach to a `Ripple` component inside of the button. */
  rippleRef: React.RefObject<RippleController | null>,
]

export function useButtonState({
  disabled,
  onBlur,
  onFocus,
  onClick,
  onDoubleClick,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
  onKeyDown,
  onKeyUp,
}: ButtonStateProps): ButtonState {
  const [focused, setFocused] = useState(false)
  const rippleRef = useRef<RippleController>(null)
  const mouseUpIsBlur = useRef(false)

  const handleBlur = useCallback(
    (event: React.FocusEvent) => {
      setFocused(false)
      rippleRef.current?.onBlur()
      if (onBlur) {
        onBlur(event)
      }
    },
    [onBlur],
  )
  const handleFocus = useCallback(
    (event: React.FocusEvent) => {
      if (event.target.matches(':focus-visible')) {
        setFocused(true)
        rippleRef.current?.onFocus()
      } else {
        mouseUpIsBlur.current = true
      }
      if (onFocus) {
        onFocus(event)
      }
    },
    [onFocus],
  )

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!event.detail) {
        // This was a programmatic click (detail = number of clicks)
        rippleRef.current?.onActivate()
        requestAnimationFrame(() => {
          rippleRef.current?.onDeactivate()
        })
      }

      if (!disabled && onClick) {
        onClick(event)
      }
    },
    [disabled, onClick],
  )
  const handleMouseUp = useCallback(() => {
    window.removeEventListener('mouseup', handleMouseUp)
    if (mouseUpIsBlur.current) {
      mouseUpIsBlur.current = false
      rippleRef.current?.onBlur()
    }
    rippleRef.current?.onDeactivate()
  }, [])
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      window.addEventListener('mouseup', handleMouseUp)

      rippleRef.current?.onActivate(event)

      if (!disabled && onMouseDown) {
        onMouseDown(event)
      }
    },
    [disabled, onMouseDown, handleMouseUp],
  )

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent) => {
      rippleRef.current?.onMouseEnter()

      if (!disabled && onMouseEnter) {
        onMouseEnter(event)
      }
    },
    [disabled, onMouseEnter],
  )
  const handleMouseLeave = useCallback(
    (event: React.MouseEvent) => {
      rippleRef.current?.onMouseLeave()

      if (!disabled && onMouseLeave) {
        onMouseLeave(event)
      }
    },
    [disabled, onMouseLeave],
  )

  const keyDownActivatedRef = useRef(false)
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const activationTarget = event.currentTarget
      if (activationTarget.matches(':active')) {
        rippleRef.current?.onActivate(event)
        keyDownActivatedRef.current = true

        if (activationTarget.matches(':focus-visible')) {
          setFocused(true)
          rippleRef.current?.onFocus()
        }
      } else {
        keyDownActivatedRef.current = false

        requestAnimationFrame(() => {
          // Sometimes browsers don't active the element until after the event has been processed,
          // so we check again on the next frame
          if (activationTarget.matches(':active')) {
            rippleRef.current?.onActivate(event)
            keyDownActivatedRef.current = true
          }

          if (activationTarget.matches(':focus-visible')) {
            setFocused(true)
            rippleRef.current?.onFocus()
          }
        })
      }

      if (onKeyDown) {
        onKeyDown(event)
      }
    },
    [onKeyDown],
  )
  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent) => {
      if (keyDownActivatedRef.current) {
        rippleRef.current?.onDeactivate()
        keyDownActivatedRef.current = false
      }

      if (onKeyUp) {
        onKeyUp(event)
      }
    },
    [onKeyUp],
  )

  const outputProps = useMemo<ButtonStateAppliedProps>(
    () => ({
      disabled: disabled === true,
      onBlur: handleBlur,
      onFocus: handleFocus,
      onClick: handleClick,
      onDoubleClick,
      onMouseDown: handleMouseDown,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onKeyDown: handleKeyDown,
      onKeyUp: handleKeyUp,
      $focused: focused,
    }),
    [
      disabled,
      focused,
      handleBlur,
      handleClick,
      handleFocus,
      handleKeyDown,
      handleKeyUp,
      handleMouseDown,
      handleMouseEnter,
      handleMouseLeave,
      onDoubleClick,
    ],
  )

  return [outputProps, rippleRef]
}

export interface HotkeyProp {
  keyCode: number
  altKey?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
}

export function keyEventMatches(event: KeyboardEvent, hotkey: HotkeyProp) {
  return (
    event.keyCode === hotkey.keyCode &&
    event.altKey === !!hotkey.altKey &&
    event.shiftKey === !!hotkey.shiftKey &&
    event.ctrlKey === !!hotkey.ctrlKey
  )
}

export interface ButtonHotkeyProps {
  /** The reference to the button that should be pressed programmatically. */
  elem: HTMLButtonElement | HTMLAnchorElement | undefined | null
  /**
   * A hotkey, or an array of hotkeys, to register for the button. Pressing any of the specified
   * modifiers and key combinations will result in the button being clicked programmatically.
   */
  hotkey: HotkeyProp | HotkeyProp[]
  /** Whether the button is disabled (hotkey will do nothing). */
  disabled?: boolean
}

export function useButtonHotkey({ elem, disabled, hotkey }: ButtonHotkeyProps) {
  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      const hotkeys = Array.isArray(hotkey) ? hotkey : [hotkey]
      for (const hotkey of hotkeys) {
        if (!disabled && keyEventMatches(event, hotkey)) {
          elem?.click()

          return true
        }
      }

      return false
    },
  })
}

export interface HotkeyedTextProps {
  /** A hotkey that is registered for the button. The text will underline the hotkeyed letter. */
  hotkey: HotkeyProp
  /** The text that should be hotkeyed. If the button is disabled, it will remain unchanged. */
  text: string
  /** Whether the button is disabled (text will remain unchanged). */
  disabled?: boolean
}

/**
 * A component which, given a hotkey and some text, underlines the character in the text of the
 * given hotkey. Technically, this component is not really button-specific, but that's mostly where
 * it will be used so we leave it here.
 */
export const HotkeyedText = React.memo(({ hotkey, text, disabled }: HotkeyedTextProps) => {
  if (disabled) {
    return <>{text}</>
  }

  const hotkeyString = String.fromCharCode(hotkey.keyCode).toLowerCase()
  const hotkeyLocation = text.toLowerCase().indexOf(hotkeyString)
  if (hotkeyLocation === -1) {
    return <>{text}</>
  } else {
    const prefix = text.slice(0, hotkeyLocation)
    const hotkeyChar = text.slice(hotkeyLocation, hotkeyLocation + 1)
    const postfix = text.slice(hotkeyLocation + 1)

    return (
      <>
        <span>{prefix}</span>
        <u>{hotkeyChar}</u>
        <span>{postfix}</span>
      </>
    )
  }
})

const IconContainer = styled.div`
  width: auto;
  height: 100%;
  display: flex;
  align-items: center;

  margin-right: 8px;
`

const FilledButtonRoot = styled.button<{ $hasIcon: boolean }>`
  ${buttonReset};
  ${fastOutSlowInShort};

  min-width: 88px;
  min-height: 40px;
  padding-inline: ${props => (props.$hasIcon ? '16px 24px' : '24px')};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 6px;
  contain: content;
  text-align: center;

  background-color: var(--theme-primary);
  color: var(--theme-on-primary);
  outline-color: var(--theme-grey-blue);

  &:hover,
  &:focus {
    ${elevationPlus1}
  }

  &:disabled,
  &[disabled] {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.12);
    box-shadow: none;
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

export interface FilledButtonProps {
  label: string | React.ReactNode
  /**
   * An optional icon to place at the starting edge of the button. For normally sized buttons, this
   * should be sized to 20px.
   */
  iconStart?: React.ReactNode
  className?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onDoubleClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  tabIndex?: number
  title?: string
  type?: 'button' | 'reset' | 'submit'
  name?: string
  as?: string | React.ComponentType<any>
  children?: React.ReactNode
  testName?: string
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * A button with a colored background that has elevation, used for high-emphasis actions.
 * ElevatedButton should generally be used for actions that are considered primary to the app.
 */
export function FilledButton({
  label,
  iconStart,
  className,
  disabled,
  onBlur,
  onFocus,
  onClick,
  onDoubleClick,
  onMouseDown,
  tabIndex,
  title,
  type = 'button',
  name,
  as = 'button',
  children,
  testName,
  ref,
}: FilledButtonProps) {
  const [buttonProps, rippleRef] = useButtonState({
    disabled,
    onBlur,
    onFocus,
    onClick,
    onDoubleClick,
    onMouseDown,
  })

  return (
    <FilledButtonRoot
      $hasIcon={!!iconStart}
      ref={ref}
      as={as}
      className={className}
      tabIndex={tabIndex}
      title={title}
      type={type}
      name={name}
      data-test={testName}
      {...buttonProps}>
      {children}
      <Label>
        {iconStart ? <IconContainer>{iconStart}</IconContainer> : null}
        {label}
      </Label>
      <Ripple ref={rippleRef} disabled={disabled} />
    </FilledButtonRoot>
  )
}

export const FilledTonalButton = styled(FilledButton)`
  background-color: var(--color-grey-blue50);
  color: var(--color-grey-blue99);
`

export const ElevatedButton = styled(FilledButton)`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};

  color: var(--color-blue80);

  &:hover,
  &:focus {
    ${elevationPlus2};
  }

  &:active {
    ${elevationPlus1};
  }

  &:disabled {
    ${elevationZero};
  }
`

export const OutlinedButton = styled(FilledButton)`
  background-color: transparent;
  color: var(--color-blue80);
  border: 1px solid var(--theme-outline);

  &:hover,
  &:focus,
  &:active {
    ${elevationZero};
  }

  &:disabled {
    background-color: transparent;
    border-color: rgb(from var(--theme-on-surface) r g b / 0.12);
  }
`

const TextButtonRoot = styled.button<{ $hasIcon: boolean }>`
  ${buttonReset};
  ${fastOutSlowInShort};

  min-width: 64px;
  min-height: 40px;
  padding-inline: ${props => (props.$hasIcon ? '12px 16px' : '12px')};
  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 6px;
  contain: content;
  text-align: center;

  background-color: transparent;
  color: var(--theme-amber);
  outline-color: var(--theme-grey-blue);

  &:disabled {
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

export interface TextButtonProps {
  label: string | React.ReactNode
  /**
   * An optional icon to place at the starting edge of the button. For normally sized buttons, this
   * should be sized to 20px.
   */
  iconStart?: React.ReactNode
  className?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onDoubleClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  tabIndex?: number
  title?: string
  type?: 'button' | 'reset' | 'submit'
  name?: string
  testName?: string
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * A button with no background (only text), used for less-pronounced actions (such as in dialogs
 * and cards).
 */
export function TextButton({
  label,
  className,
  disabled,
  iconStart,
  onBlur,
  onFocus,
  onClick,
  onDoubleClick,
  onMouseDown,
  tabIndex,
  title,
  type = 'button',
  name,
  testName,
  ref,
}: TextButtonProps) {
  const [buttonProps, rippleRef] = useButtonState({
    disabled,
    onBlur,
    onFocus,
    onClick,
    onDoubleClick,
    onMouseDown,
  })

  return (
    <TextButtonRoot
      $hasIcon={!!iconStart}
      ref={ref}
      className={className}
      tabIndex={tabIndex}
      title={title}
      type={type}
      name={name}
      data-test={testName}
      {...buttonProps}>
      <Label>
        {iconStart ? <IconContainer>{iconStart}</IconContainer> : null}
        {label}
      </Label>
      <Ripple ref={rippleRef} disabled={disabled} />
    </TextButtonRoot>
  )
}

const IconButtonRoot = styled.button`
  ${buttonReset};

  width: 48px;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: transparent;
  border-radius: 6px;
  color: var(--theme-on-surface-variant);
  contain: content;
  outline-color: var(--theme-grey-blue);

  transition:
    color 150ms linear,
    opacity 150ms linear;

  &:disabled {
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
  }

  &:focus-visible {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

export interface IconButtonProps {
  icon: React.ReactNode
  title?: string
  className?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onDoubleClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  tabIndex?: number
  type?: 'button' | 'reset' | 'submit'
  name?: string
  testName?: string
  ariaLabel?: string
  ref?: React.Ref<HTMLButtonElement>
}

/** A button that displays just an icon (with no text, and no background or elevation). */
export function IconButton({
  icon,
  title,
  className,
  disabled,
  onBlur,
  onFocus,
  onClick,
  onDoubleClick,
  onMouseDown,
  tabIndex,
  type = 'button',
  name,
  testName,
  ariaLabel,
  ref,
}: IconButtonProps) {
  const [buttonProps, rippleRef] = useButtonState({
    disabled,
    onBlur,
    onFocus,
    onClick,
    onDoubleClick,
    onMouseDown,
  })

  return (
    <IconButtonRoot
      ref={ref}
      className={className}
      tabIndex={tabIndex}
      title={title}
      type={type}
      name={name}
      data-test={testName}
      aria-label={ariaLabel}
      {...buttonProps}>
      {icon}
      <Ripple ref={rippleRef} disabled={disabled} />
    </IconButtonRoot>
  )
}
