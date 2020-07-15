import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { ButtonCommon } from '../material/button.jsx'

import { colorTextPrimary, colorTextSecondary, colorTextFaint } from '../styles/colors'
import { buttonText, robotoCondensed } from '../styles/typography'

const Container = styled(ButtonCommon)`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 96px;
  padding: 8px;
  margin-top: 8px;
  border-radius: 0;
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
  ${robotoCondensed}
  font-family: 'Roboto Condensed', Roboto, sans-serif;
  font-size: 12px;
  font-weight: 700;
  margin-top: 8px;
`

const ActivityButton = React.forwardRef((props, ref) => {
  const { label, icon, disabled, onClick } = props

  return (
    <Container ref={ref} disabled={disabled} onClick={onClick}>
      <div>{icon}</div>
      <Label>{label}</Label>
    </Container>
  )
})

ActivityButton.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.element.isRequired,
  disabled: PropTypes.bool,
  onClick: PropTypes.func,
}

export default ActivityButton
