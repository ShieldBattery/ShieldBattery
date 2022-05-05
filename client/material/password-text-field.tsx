import React, { useCallback, useState } from 'react'
import styled, { css } from 'styled-components'
import ShowPasswordIcon from '../icons/material/visibility-24px.svg'
import HidePasswordIcon from '../icons/material/visibility_off-24px.svg'
import { IconButton } from './button'
import { TextField, TextFieldProps } from './text-field'

const VisibilityButton = styled(IconButton)<{ $dense?: boolean }>`
  ${props => {
    return props.$dense
      ? css`
          width: 32px;
          height: 32px;
          min-height: 32px;
          padding: 0;
        `
      : ''
  }}
`

export function PasswordTextField(props: TextFieldProps) {
  const [visible, setVisible] = useState(false)

  const onToggleVisibility = useCallback(() => {
    setVisible(!visible)
  }, [visible])

  const visibilityButton = (
    <VisibilityButton
      icon={visible ? <ShowPasswordIcon /> : <HidePasswordIcon />}
      title={visible ? 'Hide password' : 'Show password'}
      $dense={props.dense}
      onClick={onToggleVisibility}
    />
  )

  return (
    <TextField {...props} type={visible ? 'text' : 'password'} trailingIcons={[visibilityButton]} />
  )
}
