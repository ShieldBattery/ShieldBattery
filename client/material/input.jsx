import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorTextFaint, colorTextPrimary } from '../styles/colors'
import { Subheading, singleLine } from '../styles/typography'

export const InputWrapper = styled(Subheading)`
  flex-grow: 1;
  order: 2;
  width: 100%;
  height: 100%;
  padding: ${props => (props.floatingLabel ? '20px 12px 4px' : '12px')};
  border: none;
  border-radius: 0;
  outline: none;
  background: none;
  color: ${props => (props.disabled ? colorTextFaint : colorTextPrimary)};
  line-height: inherit;
  -ms-flex-preferred-size: inherit;
  ${singleLine};

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

const Input = React.forwardRef((props, ref) => (
  <InputWrapper as='input' ref={ref} className={props.className} {...props} />
))

Input.propTypes = {
  floatingLabel: PropTypes.bool,
  disabled: PropTypes.bool,
  leadingIcon: PropTypes.bool,
  trailingIcon: PropTypes.bool,
}

export default Input
