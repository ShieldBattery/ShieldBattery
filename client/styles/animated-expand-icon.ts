import { MaterialIcon } from '../icons/material/material-icon.js'
import { fastOutSlowIn } from '../material/curve-constants.js'
import { styledWithAttrs } from './styled-with-attrs.js'

/**
 * An expand icon which can be rotated by a 180 degrees. Usually used in accordion-like components.
 */
export const AnimatedExpandIcon = styledWithAttrs(MaterialIcon)({ icon: 'expand_less' })<{
  $pointUp?: boolean
}>`
  color: inherit;
  transform: rotate(${props => (props.$pointUp ? '0deg' : '180deg')});
  transition: transform 125ms ${fastOutSlowIn};
  will-change: transform;
`
