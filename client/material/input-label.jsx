import PropTypes from 'prop-types'
import styled from 'styled-components'
import { colorTextFaint, colorTextSecondary } from '../styles/colors'

const Label = styled.label`
  position: absolute;
  left: ${props => {
    if (!props.leadingIconsLength) return '12px'

    const iconWidth = props.dense ? 32 : 48
    const leftOffset = props.leadingIconsLength * iconWidth + (props.leadingIconsLength + 1) * 4

    return `${leftOffset}px`
  }};
  top: 0;
  transform: ${props => (props.dense ? 'translate3d(0, 11px, 0)' : 'translate3d(0, 19px, 0)')};
  z-index: 1;
  color: ${props => (props.disabled ? colorTextFaint : colorTextSecondary)};
  pointer-events: none;
  opacity: ${props => (props.hasValue ? 0 : 1)};
`

Label.propTypes = {
  children: PropTypes.string.isRequired,
  htmlFor: PropTypes.string,
  hasValue: PropTypes.bool,
  dense: PropTypes.bool,
  disabled: PropTypes.bool,
  leadingIconsLength: PropTypes.number,
}

export default Label
