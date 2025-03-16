import React, { useCallback, useId, useLayoutEffect, useState } from 'react'
import styled, { css } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { useMultiRef, useStableCallback } from '../state-hooks'
import { IconButton } from './button'
import { InputBase } from './input-base'
import { InputError } from './input-error'
import { FloatingLabel } from './input-floating-label'
import { Label } from './input-label'
import { InputUnderline } from './input-underline'
import { Tooltip } from './tooltip'

// NOTE(2Pac): You might notice that this component (and others that are used here) might have some
// weird values used for paddings and margins, like 1px, or 7px. This is fine. It's mostly caused by
// the intrinsic weirdness of the <input> element itself and the way its implemented in the browser.
// Like, its vertical centering of the text might be off by 1 pixel than what it is for labels that
// we use flex to center with here. To ensure the pixel-perfect alignment of some elements, certain
// numbers had to be fudged a bit which was ascertained by using custom browser extensions to
// measure the distance in pixels.

const TextFieldContainer = styled.div<{
  $dense?: boolean
  $disabled?: boolean
  $floatingLabel?: boolean
  $focused?: boolean
  $maxRows?: number
  $multiline?: boolean
}>`
  position: relative;

  width: 100%;
  min-height: ${props => (props.$dense ? '40px' : '56px')};

  display: flex;
  flex-direction: column;
  align-items: flex-start;

  font-size: 16px;
  line-height: 20px;

  background-color: ${props =>
    props.$disabled
      ? 'rgb(from var(--theme-on-surface) r g b / calc(1 / var(--theme-disabled-opacity) * 0.04))'
      : 'var(--theme-container-highest)'};
  border-radius: 6px 6px 0 0;
  contain: layout paint style;
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};
  user-select: text;

  pointer-events: ${props => (props.$disabled ? 'none' : 'unset')};

  ${props => {
    const spacing = props.$floatingLabel ? 34 : 28 /* textfield padding + input margin */
    const height = props.$dense ? 40 : 56

    return `max-height: ${props.$maxRows ? props.$maxRows * 20 + spacing : height}px;`
  }}

  ${props => {
    if (!props.$multiline) return ''

    // TODO(2Pac): Rework this if/when we move to a new version of TextFields without a floating
    // label. The only reason why we're adding the padding here instead of to the `textarea` element
    // itself is because the floating label overlaps the scrolled content, so we have to push the
    // scrollable content down. But that also means that the area that this padding covers is not
    // natively clickable to focus the `textarea`. I've added a click handler below which does that
    // manually for now, but that can also be removed if/when we move to a new version of TextField.
    if (props.$floatingLabel) {
      // NOTE(2Pac): We only set the top padding here to keep the floating label above the
      // scrollable area.
      return props.$dense ? 'padding-top: 17px;' : 'padding-top: 25px;'
    } else {
      // NOTE(2Pac): The padding for `textarea` without a floating label will be added to the input
      // itself to avoid the issues described above.
      return ''
    }
  }}

  & input[type='text'],
  & input[type='password'],
  & input[type='datetime'],
  & input[type='datetime-local'],
  & input[type='date'],
  & input[type='month'],
  & input[type='time'],
  & input[type='week'],
  & input[type='number'],
  & input[type='email'],
  & input[type='url'],
  & input[type='search'],
  & input[type='tel'],
  & input[type='color'],
  & textarea {
    -moz-appearance: none;
    -webkit-appearance: none;
    appearance: none;
  }
`

const StateLayer = styled.div`
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
`

const iconStyle = css<{ $dense?: boolean }>`
  position: absolute;
  top: 4px;
  width: ${props => (props.$dense ? '32px' : '48px')};
  height: ${props => (props.$dense ? '32px' : '48px')};
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--theme-on-surface-variant);
`

const LeadingIcon = styled.span<{ $dense?: boolean; $index: number }>`
  ${iconStyle}
  left: ${props => {
    const iconWidth = props.$dense ? 32 : 48
    const leftOffset = props.$index * iconWidth + (props.$index + 1) * 4

    return `${leftOffset}px`
  }};
`

const TrailingIcon = styled.span<{ $dense?: boolean; $index: number; $multiline?: boolean }>`
  ${iconStyle}
  right: ${props => {
    const iconWidth = props.$dense ? 32 : 48
    const multilinePadding = props.$multiline ? 12 : 0
    const rightOffset = props.$index * iconWidth + (props.$index + 1) * 4 + multilinePadding

    return `${rightOffset}px`
  }};
`

const ClearTooltip = styled(Tooltip)`
  height: 32px;
`

const ClearButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
`

export type TextSelectionDirection = 'forward' | 'backward' | 'none'

export interface TextFieldProps {
  allowErrors?: boolean
  className?: string
  dense?: boolean
  disabled?: boolean
  errorText?: string
  floatingLabel?: boolean
  hasClearButton?: boolean
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
  label?: string
  leadingIcons?: React.ReactElement[]
  maxRows?: number
  multiline?: boolean
  name?: string
  testName?: string
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  onEnterKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  rows?: number
  trailingIcons?: React.ReactElement[]
  type?: string
  value: string
}

/**
 * A Material text field component with single-line, multi-line and text area variants, supporting
 * with and without floating labels.
 */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      allowErrors = true,
      className,
      dense,
      disabled,
      errorText,
      floatingLabel,
      hasClearButton,
      inputProps,
      label,
      leadingIcons = [],
      maxRows,
      multiline,
      name,
      testName,
      onBlur,
      onChange,
      onEnterKeyDown,
      onFocus,
      onKeyDown,
      rows = 1,
      trailingIcons = [],
      type = 'text',
      value,
    },
    ref,
  ) => {
    const id = useId()
    const [isFocused, setIsFocused] = useState(false)
    const [inputRef, setInputRef] = useMultiRef<HTMLInputElement>(ref)

    const autoSize = useCallback((elem: HTMLInputElement) => {
      // Needed in order to lower the height when deleting text
      elem.style.height = 'auto'
      elem.style.height = `${elem.scrollHeight}px`
      // Textarea doesn't scroll completely to the end when adding a new line, just to the
      // baseline of the added text it seems, so we scroll manually to the end here
      elem.scrollTop = elem.scrollHeight
    }, [])

    useLayoutEffect(() => {
      if (multiline && inputRef.current) {
        autoSize(inputRef.current)
      }
    }, [autoSize, inputRef, multiline])

    const onInputBlur = useCallback(
      (event: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(false)
        onBlur?.(event)
      },
      [onBlur],
    )

    const onInputFocus = useCallback(
      (event: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(true)
        onFocus?.(event)
      },
      [onFocus],
    )

    const onInputChange = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        if (multiline) {
          autoSize(event.target)
        }

        onChange?.(event)
      },
      [autoSize, multiline, onChange],
    )

    const onInputKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          onEnterKeyDown?.(event)
        }

        onKeyDown?.(event)
      },
      [onEnterKeyDown, onKeyDown],
    )

    const internalInputProps = {
      id,
      value,
      type,
      name,
      disabled,
      onBlur: onInputBlur,
      onChange: onInputChange,
      onFocus: onInputFocus,
      onKeyDown: onInputKeyDown,
    }

    const leadingIconsElements = leadingIcons.map((leadingIcon, index) => {
      return (
        <LeadingIcon key={index} $index={index} $dense={dense}>
          {leadingIcon}
        </LeadingIcon>
      )
    })
    const trailingIconsElements = trailingIcons
      .slice() // Don't mutate the original array
      .reverse()
      .map((trailingIcon, index) => {
        return (
          <TrailingIcon key={index} $index={index} $dense={dense} $multiline={multiline}>
            {trailingIcon}
          </TrailingIcon>
        )
      })

    const clearAndFocusInput = useStableCallback(() => {
      if (!inputRef.current) {
        return
      }

      // React overrides the input value setter so we have to do shenanigans to set a value
      // manually. See this answer for more info: https://stackoverflow.com/a/46012210/398302
      const nativeInputValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )
      nativeInputValue?.set?.call(inputRef.current, '')
      const changeEvent = new Event('input', { bubbles: true })
      inputRef.current.dispatchEvent(changeEvent)
      inputRef.current?.focus()
    })

    if (hasClearButton && value) {
      trailingIconsElements.push(
        <TrailingIcon
          key={trailingIconsElements.length}
          $index={trailingIconsElements.length}
          $dense={dense}
          $multiline={multiline}>
          <ClearTooltip text='Clear'>
            <ClearButton icon={<MaterialIcon icon='close' />} onClick={clearAndFocusInput} />
          </ClearTooltip>
        </TrailingIcon>,
      )
    }

    let renderLabel
    if (!label) {
      renderLabel = null
    } else if (floatingLabel) {
      renderLabel = (
        <FloatingLabel
          htmlFor={id}
          $hasValue={!!value}
          $dense={dense}
          $focused={isFocused}
          $disabled={disabled}
          $error={!!errorText}
          $leadingIconsLength={leadingIcons.length}>
          {label}
        </FloatingLabel>
      )
    } else {
      renderLabel = (
        <Label
          htmlFor={id}
          $hasValue={!!value}
          $dense={dense}
          $disabled={disabled}
          $leadingIconsLength={leadingIcons.length}>
          {label}
        </Label>
      )
    }

    return (
      <div className={className}>
        <TextFieldContainer
          $disabled={disabled}
          $focused={isFocused}
          $floatingLabel={floatingLabel}
          $dense={dense}
          $multiline={multiline}
          $maxRows={maxRows}
          onClick={() => inputRef.current?.focus()}>
          {renderLabel}
          {leadingIconsElements.length > 0 ? leadingIconsElements : null}
          <InputBase
            ref={setInputRef}
            as={multiline ? 'textarea' : 'input'}
            rows={rows}
            $focused={isFocused}
            $floatingLabel={floatingLabel}
            $dense={dense}
            $multiline={multiline}
            $leadingIconsLength={leadingIcons.length}
            $trailingIconsLength={trailingIcons.length}
            data-test={testName}
            {...inputProps}
            {...internalInputProps}
          />
          {trailingIconsElements.length > 0 ? trailingIconsElements : null}
          <InputUnderline focused={isFocused} error={!!errorText} />
          <StateLayer />
        </TextFieldContainer>
        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  },
)
