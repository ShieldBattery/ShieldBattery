import React, { useCallback, useState } from 'react'
import styled, { css } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
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
      icon={visible ? <MaterialIcon icon='visibility' /> : <MaterialIcon icon='visibility_off' />}
      title={visible ? 'Hide password' : 'Show password'}
      $dense={props.dense}
      onClick={onToggleVisibility}
    />
  )

  return (
    <TextField {...props} type={visible ? 'text' : 'password'} trailingIcons={[visibilityButton]} />
  )
}
