import styled from 'styled-components'
import { standardEasing } from '../../material/curve-constants'

/*
  A radio's visual only: the ring and dot, with no input or accessibility semantics of its own. The
  control it marks is expected to carry `role='radio'` and `aria-checked` itself, since the preset
  pickers make whole columns and cards the clickable target rather than the indicator.
*/

const RadioIndicator = styled.div<{ $selected: boolean }>`
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  color: ${props => (props.$selected ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
  transition: color 150ms linear;
`

const RadioRing = styled.div`
  position: relative;
  width: 20px;
  height: 20px;

  border: 2px solid currentColor;
  border-radius: 50%;
  box-sizing: border-box;
`

const RadioDot = styled.div<{ $selected: boolean }>`
  position: absolute;
  top: 3px;
  left: 3px;
  width: 10px;
  height: 10px;

  background-color: currentColor;
  border-radius: 50%;
  transform: scale(${props => (props.$selected ? 1 : 0)});
  transition: transform 150ms ${standardEasing};
`

export function GameDefaultsRadio({
  selected,
  className,
}: {
  selected: boolean
  className?: string
}) {
  return (
    <RadioIndicator className={className} $selected={selected}>
      <RadioRing>
        <RadioDot $selected={selected} />
      </RadioRing>
    </RadioIndicator>
  )
}
