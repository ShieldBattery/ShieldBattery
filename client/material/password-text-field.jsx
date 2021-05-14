import React from 'react'
import styled from 'styled-components'
import ShowPasswordIcon from '../icons/material/visibility-24px.svg'
import HidePasswordIcon from '../icons/material/visibility_off-24px.svg'
import { colorTextSecondary } from '../styles/colors'
import { Label } from './button'
import IconButton from './icon-button'
import TextField from './text-field'

const VisibilityButton = styled(IconButton)`
  ${props => {
    return props.dense
      ? `
        width: 32px;
        height: 32px;
        min-height: 32px;
        padding: 0;
      `
      : ''
  }}

  & ${Label} {
    color: ${colorTextSecondary};
  }
`

export default class PasswordTextField extends React.Component {
  state = {
    visible: false,
  }

  render() {
    const { visible } = this.state

    const visibilityButton = (
      <VisibilityButton
        icon={visible ? <ShowPasswordIcon /> : <HidePasswordIcon />}
        title={visible ? 'Hide password' : 'Show password'}
        dense={this.props.dense}
        onClick={this.onToggleVisibility}
      />
    )

    return (
      <TextField
        {...this.props}
        type={visible ? 'text' : 'password'}
        trailingIcons={[visibilityButton]}
      />
    )
  }

  onToggleVisibility = () => {
    this.setState({ visible: !this.state.visible })
  }
}
