import styled from 'styled-components'
import ExpandIcon from '../icons/material/expand_less_black_24px.svg'
import { fastOutSlowIn } from '../material/curve-constants'

/**
 * An expand icon which can be rotated by a 180 degrees. Usually used in accordion-like components.
 * By default the icon is pointing upwards, but can be made to point downwards by default with the
 * `$reversed` prop.
 */
export const AnimatedExpandIcon = styled(ExpandIcon)<{ $flipped?: boolean; $reversed?: boolean }>`
  color: inherit;
  transform: rotate(
    ${props => {
      const rotateFrom = props.$reversed ? '0deg' : '180deg'
      const rotateTo = props.$reversed ? '180deg' : '0deg'
      return props.$flipped ? rotateFrom : rotateTo
    }}
  );
  transition: transform 125ms ${fastOutSlowIn};
  will-change: transform;
`
