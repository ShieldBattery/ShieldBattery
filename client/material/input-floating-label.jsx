import PropTypes from 'prop-types'
import styled from 'styled-components'

import { fastOutSlowInShort } from './curves'
import { amberA400, colorTextFaint, colorTextSecondary, colorError } from '../styles/colors'

const FloatingLabel = styled.label`
  position: absolute;
  left: 12px;
  top: 50%;
  z-index: 1;
  color: ${props => {
    if (props.error) {
      return colorError
    }
    if (props.disabled) {
      return colorTextFaint
    }
    if (props.focused) {
      return amberA400
    }

    return colorTextSecondary
  }};
  pointer-events: none;
  transform: ${props =>
    props.hasValue || props.focused
      ? 'translate3d(0, -22px, 0) scale(0.75)'
      : 'translate3d(0, -50%, 0)'};
  transform-origin: left top;
  ${fastOutSlowInShort};

  ${props =>
    props.error
      ? `
        &::after {
          margin-left: 2px;
          content: '*';
        }
      `
      : ''}
`

FloatingLabel.propTypes = {
  children: PropTypes.string.isRequired,
  htmlFor: PropTypes.string,
  hasValue: PropTypes.bool,
  focused: PropTypes.bool,
  error: PropTypes.bool,
  disabled: PropTypes.bool,
}

export default FloatingLabel
