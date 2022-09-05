import styled from 'styled-components'
import ExpandIcon from '../icons/material/expand_less-24px.svg'
import { fastOutSlowIn } from '../material/curve-constants'

/**
 * An expand icon which can be rotated by a 180 degrees. Usually used in accordion-like components.
 */
export const AnimatedExpandIcon = styled(ExpandIcon)<{ $pointUp?: boolean }>`
  color: inherit;
  transform: rotate(${props => (props.$pointUp ? '0deg' : '180deg')});
  transition: transform 125ms ${fastOutSlowIn};
  will-change: transform;
`
