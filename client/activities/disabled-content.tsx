import { rgba } from 'polished'
import { styled } from 'styled-components'
import Card from '../material/card.js'
import { shadow8dp } from '../material/shadows.js'
import { dialogScrim } from '../styles/colors.js'
import { body1 } from '../styles/typography.js'

export const DisabledOverlay = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  background-color: ${rgba(dialogScrim, 0.5)};
  contain: strict;
  z-index: 100;
`

export const DisabledCard = styled(Card)`
  ${shadow8dp};

  position: relative;
  width: 384px;
  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
`

export const DisabledText = styled.span`
  ${body1};
  margin: 24px 0 16px 0;
  overflow-wrap: break-word;
`
