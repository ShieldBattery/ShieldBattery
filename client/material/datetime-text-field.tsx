import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Except, Simplify } from 'type-fest'
import { useMultiplexRef } from '../react/refs'
import { IconButton } from './button'
import { TextField, TextFieldProps } from './text-field'

/** A `TextField` that accepts a local date/time (using the native picker). */
export function DateTimeTextField({
  value,
  ref,
  ...rest
}: Simplify<
  Except<TextFieldProps, 'value' | 'alwaysHasValue'> & {
    /**
     * The current value of the field, in local date/time format (YYYY-MM-DDTHH:mm:ss). Seconds are
     * optional.
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
    <TextField
      {...rest}
      ref={multiplexedRef}
      type='datetime-local'
      alwaysHasValue={true}
      value={value}
      trailingIcons={[
        <IconButton
          key='picker'
          icon='calendar_clock'
          onClick={() => {
            inputRef.current?.showPicker()
          }}
          ariaLabel={t('material.datetimeTextField.pickerButtonLabel', 'Show picker')}
        />,
      ]}
    />
  )
}
