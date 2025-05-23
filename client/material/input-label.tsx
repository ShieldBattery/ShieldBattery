import styled from 'styled-components'

export const Label = styled.label<{
  $dense?: boolean
  $disabled?: boolean
  $hasValue?: boolean
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
  transform: ${props => (props.$dense ? 'translate3d(0, 11px, 0)' : 'translate3d(0, 19px, 0)')};

  pointer-events: none;
  z-index: 1;

  color: ${props =>
    props.$disabled ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
  opacity: ${props => (props.$hasValue ? 0 : 1)};
`
