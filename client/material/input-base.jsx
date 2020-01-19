import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorTextFaint, colorTextPrimary, grey700, grey800, grey900 } from '../styles/colors'
import { Subheading, singleLine } from '../styles/typography'

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

  ${props => {
    if (props.multiline) {
      const scrollbarColor = props.focused ? grey800 : grey700

      return `
        padding: 0;
        padding-bottom: 7px;
        overflow-y: auto;
        resize: none;
        cursor: auto;

        &::-webkit-scrollbar {
          width: 12px;
        }

        &::-webkit-scrollbar-track {
          background-color: ${scrollbarColor};
        }

        &::-webkit-scrollbar-thumb {
          width: 100%;
          border-left: 2px solid ${scrollbarColor};
          border-right: 2px solid ${scrollbarColor};
          margin-left: auto;
          margin-right: auto;
          background-color: ${grey900};
        }

        ::-webkit-scrollbar-button:start:decrement,
        ::-webkit-scrollbar-button:end:increment {
          height: 2px;
          background-color: ${scrollbarColor};
        }
      `
    } else {
      return `
        height: 24px;
        ${singleLine};
      `
    }
  }}
  ${props =>
    props.leadingIconsLength
      ? `padding-left:
          calc(${props.leadingIconsLength} * 48px + ${props.leadingIconsLength + 1} * 4px)
        `
      : ''};
  ${props => {
    if (props.trailingIconsLength) {
      return props.multiline
        ? `padding-right:
          calc(${props.trailingIconsLength} * 48px + ${props.trailingIconsLength + 1} * 4px + 12px)
        `
        : `padding-right:
          calc(${props.trailingIconsLength} * 48px + ${props.trailingIconsLength + 1} * 4px)
        `
    }

    return ''
  }}
`

InputBase.propTypes = {
  floatingLabel: PropTypes.bool,
  disabled: PropTypes.bool,
  multiline: PropTypes.bool,
  leadingIconsLength: PropTypes.number,
  trailingIconsLength: PropTypes.number,
}

export default InputBase
