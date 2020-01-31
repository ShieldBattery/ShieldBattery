import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { ButtonCommon } from '../material/button.jsx'

import { colorTextPrimary, colorTextSecondary, colorTextFaint } from '../styles/colors'
import { buttonText } from '../styles/typography'

const Container = styled(ButtonCommon)`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 96px;
  padding: 8px;
  margin-top: 8px;
  color: ${colorTextSecondary};

  ${props => {
    if (props.disabled) {
      return `color: ${colorTextFaint};`
    }

    return `
      &:hover {
        color: ${colorTextPrimary};
        background-color: rgba(255, 255, 255, 0.05);
      }

      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
    `
  }}
`

const Label = styled.span`
  ${buttonText};
  font-size: 11px;
  margin-top: 8px;
`

export default class ActivityButton extends React.Component {
  static propTypes = {
    label: PropTypes.string.isRequired,
    icon: PropTypes.element.isRequired,
    disabled: PropTypes.bool,
    onClick: PropTypes.func,
  }

  render() {
    const { label, icon, disabled, onClick } = this.props

    return (
      <Container disabled={disabled} onClick={onClick}>
        <div>{icon}</div>
        <Label>{label}</Label>
      </Container>
    )
  }
}
