import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Except, Simplify } from 'type-fest'
import { useMultiplexRef } from '../react/refs'
import { IconButton } from './button'
import { TextField, TextFieldProps } from './text-field'

// The field already renders its own picker button (below), which opens the native picker via
// `showPicker()`, so the browser's built-in indicator would just be a redundant second icon.
const StyledTextField = styled(TextField)`
  & input::-webkit-calendar-picker-indicator {
    display: none;
  }
`

/**
 * A `TextField` that accepts a local calendar date (using the native picker).
 *
 * The label always floats: date inputs render placeholder text (e.g. mm/dd/yyyy) even when empty,
 * so the field always appears filled and a non-floating label would never be visible.
 */
export function DateTextField({
  value,
  ref,
  ...rest
}: Simplify<
  Except<TextFieldProps, 'value' | 'alwaysHasValue' | 'floatingLabel'> & {
    /**
     * The current value of the field, in local date format (YYYY-MM-DD).
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Date_and_time_formats#local_date_and_time_strings
     */
    value: string
  }
>) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const multiplexedRef = useMultiplexRef(inputRef, ref)

  return (
    <StyledTextField
      {...rest}
      ref={multiplexedRef}
      type='date'
      alwaysHasValue={true}
      floatingLabel={true}
      value={value}
      trailingIcons={[
        <IconButton
          key='picker'
          icon='calendar_month'
          onClick={() => {
            inputRef.current?.showPicker()
          }}
          ariaLabel={t('material.dateTextField.pickerButtonLabel', 'Show picker')}
        />,
      ]}
    />
  )
}
