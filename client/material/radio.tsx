import * as React from 'react'
import { InputHTMLAttributes, ReactElement, useId } from 'react'
import styled from 'styled-components'
import { bodyMedium, labelMedium } from '../styles/typography'
import { useButtonState } from './button'
import { standardEasing } from './curve-constants'
import { Ripple } from './ripple'

const noop = () => {}

const RadioGroupContainer = styled.div<{ $dense?: boolean }>`
  display: flex;
  flex-direction: column;

  // Align the left side of the radio group with the outer circle of the radio icon.
  margin-left: ${props => (props.$dense ? -6 : -14)}px;
`

const RadioOverline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);

  padding: 4px 0;
`

export interface RadioGroupProps<T> {
  children: Array<ReturnType<typeof RadioButton> | null | undefined>
  value: T
  name?: string
  label?: React.ReactNode
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
  dense?: boolean
}

export function RadioGroup<T>({
  children,
  value,
  name,
  label,
  onChange,
  className,
  dense,
}: RadioGroupProps<T>) {
  const radioButtons = React.Children.map(children, (_child, i) => {
    if (!_child || typeof _child !== 'object' || !('props' in _child)) {
      return _child
    }

    const child = _child as ReactElement<RadioButtonProps<T>>

    const isSelected = value === child.props.value
    return React.cloneElement(child, {
      key: `button-${i}`,
      name,
      dense,
      selected: isSelected,
    })
  })

  return (
    <>
      {label ? <RadioOverline>{label}</RadioOverline> : null}
      <RadioGroupContainer className={className} onChange={onChange} $dense={dense}>
        {radioButtons}
      </RadioGroupContainer>
    </>
  )
}

interface RadioButtonProps<T> {
  label: React.ReactNode
  value: T
  disabled?: boolean
  inputProps?: InputHTMLAttributes<HTMLInputElement>
  className?: string
  /**
   * The name of the radio button, used mostly in forms. This will be set by the containing Radio
   * component and should not be passed directly.
   */
  name?: string
  /**
   * Whether or not the radio button is the selected one. This will be set by the containing Radio
   * component and should not be passed directly.
   */
  selected?: boolean
  /**
   * Whether to use a dense layout. This will be set by the containing Radio component and should
   * not be passed directly.
   */
  dense?: boolean
  testName?: string
}

const RadioButtonContainer = styled.div`
  position: relative;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  input {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    margin: 0;

    appearance: none;
    outline: none;

    cursor: pointer;
  }
`

const IconContainer = styled.div<{ $disabled?: boolean; $selected?: boolean; $dense?: boolean }>`
  flex-shrink: 0;
  position: relative;
  width: ${props => (props.$dense ? 32 : 48)}px;
  height: ${props => (props.$dense ? 32 : 48)}px;

  color: ${props => {
    if (props.$disabled) return 'rgb(from var(--theme-on-surface) r g b / 0.38)'
    else if (props.$selected) return 'var(--theme-amber)'
    else return 'var(--theme-on-surface-variant)'
  }};
`

const RadioIcon = styled.div<{ $selected?: boolean; $dense?: boolean }>`
  position: relative;
  top: ${props => (props.$dense ? 6 : 14)}px;
  width: 20px;
  height: 20px;
  margin: auto;

  border-radius: 50%;

  // outer circle
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;

    border: 2px solid;
    border-radius: 50%;
    border-color: currentColor;
  }

  // inner circle
  &::after {
    content: '';
    position: absolute;
    top: 5px;
    left: 5px;
    width: 10px;
    height: 10px;

    border-radius: 50%;
    background-color: currentColor;

    transform: ${props => (props.$selected ? 'scale(1)' : 'scale(0)')};
    transition: transform 150ms ${standardEasing};
  }
`

const StyledRipple = styled(Ripple)`
  margin: 4px;
  border-radius: 50%;
`

const Label = styled.label<{ $disabled?: boolean }>`
  ${bodyMedium};

  flex-grow: 1;
  padding: 4px 0;

  color: ${props =>
    props.$disabled ? 'rgb(from var(--theme-on-surface) r g b / 0.38)' : 'var(--theme-on-surface)'};
`

export const RadioButton = React.memo(
  <T extends NonNullable<InputHTMLAttributes<HTMLInputElement>['value']>>({
    label,
    value,
    disabled,
    inputProps,
    name,
    selected,
    dense,
    testName,
  }: RadioButtonProps<T>) => {
    const id = useId()

    const [buttonProps, rippleRef] = useButtonState({ disabled })

    const internalInputProps = {
      type: 'radio',
      id,
      value,
      name,
      checked: selected,
      disabled,
      // `onChange` is handled in the RadioGroup so we just noop it here to get rid of the warning.
      onChange: noop,
    }

    return (
      <RadioButtonContainer {...buttonProps}>
        <IconContainer $disabled={disabled} $selected={selected} $dense={dense}>
          <RadioIcon $selected={selected} $dense={dense} />
          <StyledRipple ref={rippleRef} disabled={disabled} />
        </IconContainer>
        <Label htmlFor={id} $disabled={disabled}>
          {label}
        </Label>
        <input {...inputProps} {...internalInputProps} data-test={testName} />
      </RadioButtonContainer>
    )
  },
)
