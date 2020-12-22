import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { ButtonCommon } from '../material/button.jsx'

import { blue50, colorTextPrimary, colorTextSecondary, colorTextFaint } from '../styles/colors.ts'
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

const IconContainer = styled.div`
  position: relative;
  width: 36px;
  height: 42px;

  svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  ${props => {
    if (props.glowing) {
      return `
        svg:first-child {
          fill: ${blue50};
          filter: blur(4px);
        }
      `
    }

    return ''
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
  const { label, icon, disabled, glowing, onClick } = props

  return (
    <Container ref={ref} disabled={disabled} onClick={onClick}>
      <IconContainer glowing={glowing}>
        {glowing ? icon : null}
        {icon}
      </IconContainer>
      <Label>{label}</Label>
    </Container>
  )
})

ActivityButton.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.element.isRequired,
  disabled: PropTypes.bool,
  glowing: PropTypes.bool,
  onClick: PropTypes.func,
}

export default ActivityButton
