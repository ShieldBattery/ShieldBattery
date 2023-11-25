import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { RaisedButton } from './button'
import { InputError } from './input-error'

const InputContainer = styled.div`
  position: relative;
  display: flex;

  & input {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;

    opacity: 0;
    // Need to set the z-index higher than the Raised Button (which has z-index of 2 due to its drop
    // shadow).
    z-index: 3;

    cursor: pointer;
  }
`

interface FileInputProps {
  value?: File | File[] | string | null
  label?: string
  allowErrors?: boolean
  errorText?: string
  className?: string
  inputProps: React.InputHTMLAttributes<HTMLInputElement>
  onChange?: (file?: File | File[]) => void
}

export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ value, label, allowErrors = false, errorText, className, inputProps, onChange }, ref) => {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLInputElement>(null)

    if (typeof value === 'string' && value !== '') {
      throw new Error('non-empty string values are not supported for FileInput')
    }

    useEffect(() => {
      if (value && inputRef.current && inputRef.current.value !== (value as any)) {
        throw new Error(
          "FileInput's value cannot be changed to a new File programmatically, " +
            'only through user selection',
        )
      }
      if (inputRef.current?.value && !value) {
        inputRef.current.value = ''
      }
    }, [value])

    const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : []
      onChange?.(inputProps.multiple ? files : files[0])
    }

    const internalInputProps = {
      ...inputProps,
      type: 'file',
      onChange: onInputChange,
    }

    return (
      <div className={className}>
        <InputContainer>
          <RaisedButton
            as='div'
            label={label ?? t('forms.fileInput.chooseFile', 'Choose file')}
            tabIndex={-1}>
            <input ref={inputRef} {...internalInputProps} />
          </RaisedButton>
        </InputContainer>

        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  },
)

export const SingleFileInput = React.forwardRef<
  HTMLInputElement,
  Omit<FileInputProps, 'onChange'> & { onChange?: (file?: File) => void }
>((props, ref) => {
  const onInputChange = (file?: File | File[]) => {
    props.onChange?.(Array.isArray(file) ? file[0] : file)
  }

  return (
    <FileInput
      ref={ref}
      {...props}
      inputProps={{ ...props.inputProps, multiple: false }}
      onChange={onInputChange}
    />
  )
})
