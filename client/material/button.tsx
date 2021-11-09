import React, { useCallback, useRef, useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  amberA400,
  blue400,
  blue500,
  CardLayer,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { buttonText } from '../styles/typography'
import { buttonReset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { Ripple, RippleController } from './ripple'
import { shadowDef4dp, shadowDef8dp } from './shadow-constants'
import { shadow2dp } from './shadows'

export const Label = styled.span`
  ${buttonText};
  display: flex;
  justify-content: center;
  align-items: center;
  color: currentColor;
  line-height: 36px;
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
  rippleRef: React.RefObject<RippleController>,
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
      setFocused(true)
      rippleRef.current?.onFocus()
      if (onFocus) {
        onFocus(event)
      }
    },
    [onFocus],
  )

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()

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
      } else {
        keyDownActivatedRef.current = false

        requestAnimationFrame(() => {
          // Sometimes browsers don't active the element until after the event has been processed,
          // so we check again on the next frame
          if (activationTarget.matches(':active')) {
            rippleRef.current?.onActivate(event)
            keyDownActivatedRef.current = true
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

  return [
    {
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
    },
    rippleRef,
  ]
}

interface RaisedButtonStyleProps {
  $color: 'primary' | 'accent'
}

const RaisedButtonRoot = styled.button<RaisedButtonStyleProps>`
  ${buttonReset};
  ${fastOutSlowInShort};
  ${shadow2dp};

  min-width: 88px;
  min-height: 36px;
  margin: 6px 0;
  padding: 0 16px;
  display: inline-table;

  border-radius: 4px;
  contain: content;
  text-align: center;

  background-color: ${props => (props.$color === 'accent' ? amberA400 : blue500)};
  color: ${props => (props.$color === 'accent' ? 'rgba(0, 0, 0, 0.87)' : colorTextPrimary)};
  --sb-ripple-color: ${props => (props.$color === 'accent' ? '#000000' : '#ffffff')};

  &:hover,
  &:focus {
    box-shadow: ${shadowDef4dp};
  }

  &:active {
    box-shadow: ${shadowDef8dp};
  }

  &:disabled {
    background-color: rgba(255, 255, 255, 0.12);
    box-shadow: none;
    color: ${colorTextFaint};
  }

  ${CardLayer} && {
    &:disabled {
      background-color: rgba(255, 255, 255, 0.08);
    }
  }
`

export interface RaisedButtonProps {
  color?: 'primary' | 'accent'
  label: string | React.ReactNode
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
}

/**
 * A button with a colored background that has elevation, used for high-emphasis actions.
 * RaisedButton should generally be used for actions that are considered primary to the app.
 */
export const RaisedButton = React.forwardRef(
  (
    {
      color = 'primary',
      label,
      className,
      disabled,
      onBlur,
      onFocus,
      onClick,
      onDoubleClick,
      onMouseDown,
      tabIndex,
      title,
      type,
      name,
    }: RaisedButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const [buttonProps, rippleRef] = useButtonState({
      disabled,
      onBlur,
      onFocus,
      onClick,
      onDoubleClick,
      onMouseDown,
    })

    return (
      <RaisedButtonRoot
        ref={ref}
        className={className}
        $color={color}
        tabIndex={tabIndex}
        title={title}
        type={type ?? 'button'}
        name={name}
        {...buttonProps}>
        <Label>{label}</Label>
        <Ripple ref={rippleRef} disabled={disabled} />
      </RaisedButtonRoot>
    )
  },
)

interface TextButtonStyleProps {
  $color: 'normal' | 'primary' | 'accent'
}

const TextButtonRoot = styled.button<TextButtonStyleProps>`
  ${buttonReset};
  ${fastOutSlowInShort};

  min-width: 64px;
  min-height: 36px;
  margin: 6px 0;
  padding: 0 16px;
  display: inline-table;

  border-radius: 4px;
  contain: content;
  text-align: center;

  background-color: transparent;
  color: ${props => {
    switch (props.$color) {
      case 'normal':
        return colorTextSecondary
      case 'primary':
        return blue400
      case 'accent':
        return amberA400
      default:
        return assertUnreachable(props.$color)
    }
  }};
  --sb-ripple-color: ${props => {
    switch (props.$color) {
      case 'normal':
        return '#ffffff'
      case 'primary':
      case 'accent':
        return 'currentColor'
      default:
        return assertUnreachable(props.$color)
    }
  }};

  &:disabled {
    color: ${colorTextFaint};
  }
`

const IconContainer = styled.div`
  width: auto;
  height: 100%;
  display: flex;
  align-items: center;

  margin-right: 8px;
`

export interface TextButtonProps {
  color?: 'normal' | 'primary' | 'accent'
  label: string | React.ReactNode
  /** An optional icon to place at the starting edge of the button. */
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
}

/**
 * A button with no background (only text), used for less-pronounced actions (such as in dialogs
 * and cards).
 */
export const TextButton = React.forwardRef(
  (
    {
      color = 'normal',
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
      type,
      name,
    }: TextButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
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
        ref={ref}
        className={className}
        $color={color}
        tabIndex={tabIndex}
        title={title}
        type={type ?? 'button'}
        name={name}
        {...buttonProps}>
        <Label>
          {iconStart ? <IconContainer>{iconStart}</IconContainer> : null}
          {label}
        </Label>
        <Ripple ref={rippleRef} disabled={disabled} />
      </TextButtonRoot>
    )
  },
)

const IconButtonRoot = styled.button`
  ${buttonReset};
  ${fastOutSlowInShort};

  width: 48px;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: transparent;
  border-radius: 8px;
  color: ${colorTextSecondary};
  contain: content;
  --sb-ripple-color: #ffffff;

  &:disabled {
    color: ${colorTextFaint};
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
}

/** A button that displays just an icon (with no text, and no background or elevation). */
export const IconButton = React.forwardRef(
  (
    {
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
      type,
      name,
    }: IconButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
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
        type={type ?? 'button'}
        name={name}
        {...buttonProps}>
        {icon}
        <Ripple ref={rippleRef} disabled={disabled} />
      </IconButtonRoot>
    )
  },
)
