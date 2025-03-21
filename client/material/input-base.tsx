import styled, { css } from 'styled-components'
import { bodyLarge, singleLine } from '../styles/typography'

export const InputBase = styled.div<{
  $floatingLabel?: boolean
  $dense?: boolean
  $focused?: boolean
  $multiline?: boolean
  $leadingIconsLength?: number
  $trailingIconsLength?: number
}>`
  ${bodyLarge};
  flex-grow: 1;
  order: 2;
  width: 100%;
  padding: ${props => (props.$floatingLabel ? '17px 12px 4px' : '12px')};

  border: none;
  border-radius: 0;
  outline: none;

  background: none;
  caret-color: var(--theme-primary);
  color: var(--theme-on-surface);
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
    if (!props.$multiline) {
      return ''
    }

    if (props.$floatingLabel) {
      return css`
        padding: 12px;
        padding-top: 0;
      `
    } else {
      return css`
        padding: 12px;
        padding-top: ${props.$dense ? 11 : 19}px;
      `
    }
  }}

  ${props => {
    if (props.$multiline) {
      return css`
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
