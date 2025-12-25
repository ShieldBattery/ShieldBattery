import * as React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { bodyMedium, singleLine } from '../styles/typography'
import { FilledButton } from './button'
import { InputError } from './input-error'

function isValueAndFileListSame(value: File | File[], fileList: FileList): boolean {
  if (Array.isArray(value)) {
    return value.length === fileList.length && value.every((v, i) => v === fileList[i])
  } else {
    return fileList.length === 1 && value === fileList[0]
  }
}

const FileInputContainer = styled.div`
  min-width: 0;

  width: 100%;
  display: flex;
  flex-direction: column;
`

const InputContainer = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;

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

const StyledFilledButton = styled(FilledButton)`
  flex-shrink: 0;
`

const FileName = styled.span`
  ${singleLine};
  ${bodyMedium};
`

const NoFileSelected = styled.span`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const StyledInputError = styled(InputError)`
  padding-left: 4px;
`

interface FileInputProps {
  value?: File | File[] | '' | null
  label?: string
  disabled?: boolean
  showFileName?: boolean
  allowErrors?: boolean
  errorText?: string
  className?: string
  testName?: string
  inputProps: React.InputHTMLAttributes<HTMLInputElement>
  onChange?: (file?: File | File[]) => void
}

export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  (
    {
      value,
      label,
      disabled,
      showFileName = false,
      allowErrors = false,
      errorText,
      className,
      testName,
      inputProps,
      onChange,
    },
    ref,
  ) => {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLInputElement>(null)

    if (typeof value === 'string' && value !== '') {
      throw new Error('non-empty string values are not supported for FileInput')
    }

    useEffect(() => {
      if (
        value &&
        inputRef.current?.files &&
        !isValueAndFileListSame(value, inputRef.current.files)
      ) {
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
      disabled,
      type: 'file',
      onChange: onInputChange,
    }

    let fileName = ''
    if (value) {
      if (Array.isArray(value)) {
        fileName = value.map(v => v.name).join(', ')
      } else {
        fileName = value.name
      }
    }

    return (
      <FileInputContainer className={className}>
        <InputContainer>
          <StyledFilledButton
            styledAs='div'
            label={label ?? t('forms.fileInput.chooseFile', 'Choose file')}
            disabled={disabled}
            tabIndex={-1}>
            <input ref={inputRef} data-test={testName} {...internalInputProps} />
          </StyledFilledButton>

          {showFileName && fileName && <FileName>{fileName}</FileName>}
          {showFileName && !fileName && (
            <NoFileSelected>
              {t('forms.fileInput.noFileSelected', 'No file selected')}
            </NoFileSelected>
          )}
        </InputContainer>

        {allowErrors ? <StyledInputError error={errorText} /> : null}
      </FileInputContainer>
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

export const MultiFileInput = React.forwardRef<
  HTMLInputElement,
  Omit<FileInputProps, 'onChange'> & { onChange?: (files: File[]) => void }
>((props, ref) => {
  const onInputChange = (file?: File | File[]) => {
    if (!file) {
      props.onChange?.([])
      return
    }
    props.onChange?.(Array.isArray(file) ? file : [file])
  }

  return (
    <FileInput
      ref={ref}
      {...props}
      inputProps={{ ...props.inputProps, multiple: true }}
      onChange={onInputChange}
    />
  )
})
