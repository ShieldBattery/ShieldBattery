import * as React from 'react'
import { useCallback } from 'react'
import { TextField, TextFieldProps } from './text-field'

export function DateTimeTextField({
  value,
  onChange,
  ...rest
}: Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}) {
  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event.target.value)
    },
    [onChange],
  )

  return <TextField {...rest} type='datetime-local' value={value} onChange={onInputChange} />
}
