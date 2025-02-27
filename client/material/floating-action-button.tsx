import React from 'react'
import styled from 'styled-components'
import { useButtonState } from './button'
import { buttonReset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { Ripple } from './ripple'
import { shadowDef12dp, shadowDef8dp } from './shadow-constants'
import { shadow6dp } from './shadows'

const Root = styled.button`
  ${buttonReset};
  ${shadow6dp};
  ${fastOutSlowInShort};

  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-amber);
  border-radius: 50%;
  color: var(--theme-on-amber-container);
  contain: content;
  --sb-ripple-color: #000000;

  &:hover,
  &:focus {
    box-shadow: ${shadowDef8dp};
  }

  &:active {
    box-shadow: ${shadowDef12dp};
  }

  &:disabled {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.12);
    box-shadow: none;
    color: rgb(from var(--theme-on-surface) r g b / 0.38);
  }
`

export interface FloatingActionButtonProps {
  icon: React.ReactNode
  title: string
  className?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  tabIndex?: number
}

/**
 * A circular button with an icon, meant to be used for the most primary action on a particular
 * screen.
 */
export const FloatingActionButton = React.forwardRef(
  (
    {
      icon,
      title,
      className,
      disabled,
      onBlur,
      onFocus,
      onClick,
      onMouseDown,
      tabIndex,
    }: FloatingActionButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const [buttonProps, rippleRef] = useButtonState({
      disabled,
      onBlur,
      onFocus,
      onClick,
      onMouseDown,
    })

    return (
      <Root ref={ref} className={className} tabIndex={tabIndex} title={title} {...buttonProps}>
        {icon}
        <Ripple ref={rippleRef} disabled={disabled} />
      </Root>
    )
  },
)
