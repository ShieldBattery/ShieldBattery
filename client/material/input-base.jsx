import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorTextFaint, colorTextPrimary } from '../styles/colors'
import { Subheading } from '../styles/typography'

export const InputBase = styled(Subheading)`
  flex-grow: 1;
  order: 2;
  width: 100%;
  padding: ${props => (props.floatingLabel ? '17px 12px 4px' : '12px')};
  border: none;
  border-radius: 0;
  outline: none;
  background: none;
  color: ${props => (props.disabled ? colorTextFaint : colorTextPrimary)};
  line-height: inherit;
  -ms-flex-preferred-size: inherit;

  &:focus {
    outline: none;
  }

  &:invalid {
    outline: none;
    box-shadow: none;
  }

  ${props => (props.leadingIcon ? 'padding-left: 48px' : '')};
  ${props => (props.trailingIcon ? 'padding-right: 48px' : '')};
`

InputBase.propTypes = {
  floatingLabel: PropTypes.bool,
  disabled: PropTypes.bool,
  leadingIcon: PropTypes.bool,
  trailingIcon: PropTypes.bool,
}

export default InputBase
