import styled from 'styled-components'
import { colorTextSecondary } from '../styles/colors'
import { fastOutSlowInShort } from './curves'

export const FloatingLabel = styled.label<{
  $hasValue?: boolean
  $focused?: boolean
  $error?: boolean
  $disabled?: boolean
  $dense?: boolean
  $leadingIconsLength?: number
}>`
  position: absolute;
  left: ${props => {
    if (!props.$leadingIconsLength) return '12px'

    const iconWidth = props.$dense ? 32 : 48
    const leftOffset = props.$leadingIconsLength * iconWidth + (props.$leadingIconsLength + 1) * 4

    return `${leftOffset}px`
  }};
  top: 0;
  z-index: 1;
  color: ${props => {
    if (props.$error && props.$disabled) {
      return `rgb(from var(--theme-error) r g b / 0.6)`
    }
    if (props.$error) {
      return 'var(--theme-error)'
    }
    if (props.$disabled) {
      return 'rgb(from var(--theme-on-surface) r g b / 0.38)'
    }
    if (props.$focused) {
      return 'var(--theme-amber)'
    }

    return colorTextSecondary
  }};
  pointer-events: none;
  transform: ${props => {
    if (props.$hasValue || props.$focused) {
      return props.$dense
        ? 'translate3d(0, 3px, 0) scale(0.75)'
        : 'translate3d(0, 9px, 0) scale(0.75)'
    } else {
      return props.$dense ? 'translate3d(0, 11px, 0)' : 'translate3d(0, 19px, 0)'
    }
  }};
  transform-origin: left top;
  ${fastOutSlowInShort};

  ${props =>
    props.$error
      ? `
        &::after {
          margin-left: 2px;
          content: '*';
        }
      `
      : ''}
`
