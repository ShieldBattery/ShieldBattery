import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorTextFaint, colorTextSecondary } from '../styles/colors'

const Label = styled.label`
  position: absolute;
  left: ${props =>
    props.leadingIconsLength
      ? `calc(${props.leadingIconsLength} * 48px + ${props.leadingIconsLength + 1} * 4px)`
      : '12px'};
  top: 0;
  transform: translate3d(0, 19px, 0);
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
  leadingIconsLength: PropTypes.number,
}

export default Label
