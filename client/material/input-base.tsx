import styled, { css } from 'styled-components'
import { colorTextFaint, colorTextPrimary } from '../styles/colors'
import { singleLine, subtitle1 } from '../styles/typography'

export const TEXTAREA_BOTTOM_PADDING = 7
export const TEXTAREA_BOTTOM_PADDING_DENSE = 1

export const InputBase = styled.div<{
  $floatingLabel?: boolean
  $dense?: boolean
  $disabled?: boolean
  $focused?: boolean
  $multiline?: boolean
  $leadingIconsLength?: number
  $trailingIconsLength?: number
}>`
  ${subtitle1};
  flex-grow: 1;
  order: 2;
  width: 100%;
  padding: ${props => (props.$floatingLabel ? '17px 12px 4px' : '12px')};
  border: none;
  border-radius: 0;
  outline: none;
  background: none;
  color: ${props => (props.$disabled ? colorTextFaint : colorTextPrimary)};
  line-height: inherit;
  -ms-flex-preferred-size: inherit;
  user-select: inherit;

  &:focus {
    outline: none;
  }

  &:invalid {
    outline: none;
    box-shadow: none;
  }

  ${props => {
    if (props.$multiline) {
      const paddingBottom = props.$dense ? TEXTAREA_BOTTOM_PADDING_DENSE : TEXTAREA_BOTTOM_PADDING

      return css`
        padding: 0;
        padding-bottom: ${paddingBottom}px;
        overflow-y: auto;
        resize: none;
        cursor: auto;

        &::-webkit-scrollbar {
          width: 12px;
        }

        &::-webkit-scrollbar-thumb {
          width: 100%;
        }
      `
    } else {
      return css`
        height: 24px;
        ${singleLine};
      `
    }
  }}
  ${props => {
    if (!props.$leadingIconsLength) return ''

    const iconWidth = props.$dense ? 32 : 48
    const padding = props.$leadingIconsLength * iconWidth + (props.$leadingIconsLength + 1) * 4

    return `padding-left: ${padding}px;`
  }}
  ${props => {
    if (!props.$trailingIconsLength) return ''

    const iconWidth = props.$dense ? 32 : 48
    const multilinePadding = props.$multiline ? 12 : 0
    const padding =
      props.$trailingIconsLength * iconWidth +
      (props.$trailingIconsLength + 1) * 4 +
      multilinePadding

    return `padding-right: ${padding}px;`
  }}
`
