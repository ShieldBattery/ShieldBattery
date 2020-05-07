import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorTextFaint, colorTextPrimary, grey700, grey800, grey900 } from '../styles/colors'
import { Subheading, singleLine } from '../styles/typography'

export const TEXTAREA_BOTTOM_PADDING = 7
export const TEXTAREA_BOTTOM_PADDING_DENSE = 1

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
      const paddingBottom = props.dense ? TEXTAREA_BOTTOM_PADDING_DENSE : TEXTAREA_BOTTOM_PADDING

      return `
        padding: 0;
        padding-bottom: ${paddingBottom}px;
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
  ${props => {
    if (!props.leadingIconsLength) return ''

    const iconWidth = props.dense ? 32 : 48
    const padding = props.leadingIconsLength * iconWidth + (props.leadingIconsLength + 1) * 4

    return `padding-left: ${padding}px;`
  }}
  ${props => {
    if (!props.trailingIconsLength) return ''

    const iconWidth = props.dense ? 32 : 48
    const multilinePadding = props.multiline ? 12 : 0
    const padding =
      props.trailingIconsLength * iconWidth + (props.trailingIconsLength + 1) * 4 + multilinePadding

    return `padding-right: ${padding}px;`
  }}
`

InputBase.propTypes = {
  floatingLabel: PropTypes.bool,
  dense: PropTypes.bool,
  disabled: PropTypes.bool,
  multiline: PropTypes.bool,
  leadingIconsLength: PropTypes.number,
  trailingIconsLength: PropTypes.number,
}

export default InputBase
