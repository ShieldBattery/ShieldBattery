import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorTextFaint, colorTextSecondary } from '../styles/colors'

const Label = styled.label`
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translate3d(0, -50%, 0);
  z-index: 1;
  color: ${props => (props.disabled ? colorTextFaint : colorTextSecondary)};
  pointer-events: none;
  opacity: ${props => (props.hasValue ? 0 : 1)};
`

Label.propTypes = {
  children: PropTypes.string.isRequired,
  htmlFor: PropTypes.string,
  hasValue: PropTypes.bool,
  disabled: PropTypes.bool,
}

export default Label
