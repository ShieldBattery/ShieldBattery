import React from 'react'
import styled from 'styled-components'

import IconButton from './icon-button.jsx'
import { Label } from './button.jsx'
import TextField from './text-field.jsx'

import ShowPasswordIcon from '../icons/material/visibility-24px.svg'
import HidePasswordIcon from '../icons/material/visibility_off-24px.svg'

import { colorTextSecondary } from '../styles/colors'

const VisibilityButton = styled(IconButton)`
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
