import styled from 'styled-components'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { elevationPlus1 } from './shadows'

export const Card = styled.div`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)}
  border-radius: 4px;
  /* TODO(tec27): there's probably places we don't want 16px padding (full bleed images), */
  /* figure out a good way to handle that */
  padding: 16px;
`
