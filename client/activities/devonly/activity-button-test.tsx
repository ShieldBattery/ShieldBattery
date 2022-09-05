import keycode from 'keycode'
import React from 'react'
import styled from 'styled-components'
import Icon from '../../icons/material/check_circle-24px.svg'
import Card from '../../material/card'
import { background700 } from '../../styles/colors'
import ActivityBar from '../activity-bar'
import { ActivityButton } from '../activity-button'

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
            <ActivityButton icon={<Icon />} label='Default' hotkey={ALT_1} />
            <ActivityButton icon={<Icon />} label='Disabled' disabled={true} hotkey={ALT_2} />
            <ActivityButton icon={<Icon />} label='Glowing' glowing={true} hotkey={ALT_3} />
            <ActivityButton icon={<Icon />} label='Count' count={27} hotkey={ALT_4} />
            <ActivityButton
              icon={<Icon />}
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
