import React, { useCallback } from 'react'
import { TextField, TextFieldProps } from './text-field'

export function NumberTextField({
  value,
  onChange,
  ...rest
}: { value: number | null; onChange: (value: number) => void } & Omit<
  TextFieldProps,
  'value' | 'onChange'
>) {
  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(+event.target.value)
    },
    [onChange],
  )

  return (
    <TextField {...rest} type='number' value={value?.toString() ?? ''} onChange={onInputChange} />
  )
}
