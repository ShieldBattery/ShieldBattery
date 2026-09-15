import styled from 'styled-components'

export const Label = styled.label<{
  $dense?: boolean
  $disabled?: boolean
  $hasValue?: boolean
  $leadingIconsLength?: number
  $leadingContentWidth?: number
}>`
  position: absolute;
  left: ${props => {
    let leftOffset = 12

    if (props.$leadingIconsLength) {
      const iconWidth = props.$dense ? 32 : 48
      leftOffset = props.$leadingIconsLength * iconWidth + (props.$leadingIconsLength + 1) * 4
    }

    if (props.$leadingContentWidth) {
      // The label only shows while the field is empty, so it must clear the leading content
      // instead of sitting underneath it.
      leftOffset += props.$leadingContentWidth + 8
    }

    return `${leftOffset}px`
  }};
  top: 0;
  transform: ${props => (props.$dense ? 'translate3d(0, 11px, 0)' : 'translate3d(0, 19px, 0)')};

  pointer-events: none;
  z-index: 1;

  color: ${props =>
    props.$disabled ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
  opacity: ${props => (props.$hasValue ? 0 : 1)};
`
