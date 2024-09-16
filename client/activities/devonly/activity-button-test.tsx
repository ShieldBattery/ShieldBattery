import keycode from 'keycode'
import React from 'react'
import { styled } from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon.js'
import Card from '../../material/card.js'
import { background700 } from '../../styles/colors.js'
import ActivityBar from '../activity-bar.js'
import { ActivityButton } from '../activity-button.js'

const ALT_1 = { keyCode: keycode('1'), altKey: true }
const ALT_2 = { keyCode: keycode('2'), altKey: true }
const ALT_3 = { keyCode: keycode('3'), altKey: true }
const ALT_4 = { keyCode: keycode('4'), altKey: true }
const ALT_5 = { keyCode: keycode('5'), altKey: true }

const Container = styled.div`
  display: flex;
  justify-content: center;
  height: auto !important;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  max-width: 640px;
  margin-left: 16px;
  background-color: ${background700};
`

export default class ActivityButtonsTest extends React.Component {
  override render() {
    return (
      <Container>
        <StyledCard>
          <h3>Press some buttons</h3>
          <ActivityBar>
            <ActivityButton
              icon={<MaterialIcon icon='taunt' size={36} />}
              label='Default'
              hotkey={ALT_1}
            />
            <ActivityButton
              icon={<MaterialIcon icon='taunt' size={36} />}
              label='Disabled'
              disabled={true}
              hotkey={ALT_2}
            />
            <ActivityButton
              icon={<MaterialIcon icon='taunt' size={36} />}
              label='Glowing'
              glowing={true}
              hotkey={ALT_3}
            />
            <ActivityButton
              icon={<MaterialIcon icon='taunt' size={36} />}
              label='Count'
              count={27}
              hotkey={ALT_4}
            />
            <ActivityButton
              icon={<MaterialIcon icon='taunt' size={36} />}
              label='CountGlow'
              glowing={true}
              count={666}
              hotkey={ALT_5}
            />
          </ActivityBar>
        </StyledCard>
      </Container>
    )
  }
}
