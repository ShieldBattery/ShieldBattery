import React, { useRef } from 'react'
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

// Quick and ugly wrap for <input type='file'> that works with rest of the form stuff
export function FileInput({
  value,
  allowErrors = false,
  errorText,
  inputProps,
  onChange,
  onFilesCleared,
}: {
  value?: File | File[] | null
  allowErrors?: boolean
  errorText?: string
  inputProps: React.InputHTMLAttributes<HTMLInputElement>
  onChange?: (file?: File | File[]) => void
  onFilesCleared?: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div>
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
}
