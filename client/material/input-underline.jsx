import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { fastOutSlowInShort } from './curves'
import { amberA400, colorError, colorDividers } from '../styles/colors'

const UnderlineContainer = styled.div`
  order: 3;
  position: absolute;
  left: 0;
  bottom: 0;
  right: 0;
  width: 100%;
  margin: 0;
  pointer-events: none;
  color: ${props => (props.error ? colorError : amberA400)};
`

const Underline = styled.hr`
  width: 100%;
  margin: 0;
  border: none;
  border-bottom: 2px solid ${colorDividers};
  ${props => (props.error ? `border-color: ${colorError}` : '')};
`

const FocusedUnderline = styled(Underline)`
  position: absolute;
  top: 0px;
  width: 100%;
  margin-top: 0px;
  color: inherit;
  border-bottom-width: 2px;
  border-color: currentColor;
  transform: ${props => (props.focused ? 'scaleX(1)' : 'scaleX(0)')};
  ${fastOutSlowInShort};
`

const InputUnderline = props => {
  const { focused, error, disabled } = props

  if (disabled) {
    return null
  }

  return (
    <UnderlineContainer error={error}>
      <Underline error={error} />
      <FocusedUnderline focused={focused} />
    </UnderlineContainer>
  )
}

InputUnderline.propTypes = {
  focused: PropTypes.bool,
  error: PropTypes.bool,
  disabled: PropTypes.bool,
}

export default InputUnderline
