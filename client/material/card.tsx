import styled from 'styled-components'
import { CardLayer } from '../styles/colors'
import { shadow2dp } from './shadows'

const Card = styled(CardLayer)`
  ${shadow2dp};
  border-radius: 2px;
  /* TODO(tec27): there's probably places we don't want 16px padding (full bleed images), */
  /* figure out a good way to handle that */
  padding: 16px;
`

export default Card
