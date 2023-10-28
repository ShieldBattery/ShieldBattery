import React, { useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { InputError } from '../material/input-error'

// TODO(tec27): Make a Material file upload component and move this into the material/ folder

const InputContainer = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  height: 48px;
`

const ClearButton = styled(IconButton)`
  margin-left: 16px;
`

export interface FileInputHandle {
  clear: () => void
  click: () => void
}

interface FileInputProps {
  value?: File | File[] | string | null
  allowErrors?: boolean
  errorText?: string
  className?: string
  inputProps: React.InputHTMLAttributes<HTMLInputElement>
  onChange?: (file?: File | File[]) => void
  onFilesCleared?: () => void
}

// Quick and ugly wrap for <input type='file'> that works with rest of the form stuff
export const FileInput = React.forwardRef<FileInputHandle, FileInputProps>(
  (
    { value, allowErrors = false, errorText, className, inputProps, onChange, onFilesCleared },
    ref,
  ) => {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      clear: onClearClick,
      click: () => {
        inputRef.current?.click()
      },
    }))

    const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : []
      onChange?.(inputProps.multiple ? files : files[0])
    }

    const onClearClick = () => {
      if (inputRef.current) {
        inputRef.current.value = ''
      }
      onFilesCleared?.()
      onChange?.(inputProps.multiple ? [] : undefined)
    }

    const internalInputProps = {
      ...inputProps,
      type: 'file',
      onChange: onInputChange,
    }

    const hasFiles = value && (!inputProps.multiple || value.length)
    return (
      <div className={className}>
        <InputContainer>
          <input ref={inputRef} {...internalInputProps} />
          {hasFiles ? (
            <ClearButton
              icon={<MaterialIcon icon='close' />}
              title={t('forms.fileInput.clearFiles', 'Clear files')}
              onClick={onClearClick}
            />
          ) : null}
        </InputContainer>

        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  },
)

export const SingleFileInput = React.forwardRef<
  FileInputHandle,
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
