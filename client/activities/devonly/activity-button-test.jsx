import React from 'react'
import styled from 'styled-components'

import ActivityBar from '../activity-bar.jsx'
import ActivityButton from '../activity-button.jsx'
import Card from '../../material/card.jsx'

import Icon from '../../icons/material/baseline-check_circle-24px.svg'

import { grey850 } from '../../styles/colors.ts'

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
  background-color: ${grey850};
`

export default class ActivityButtonsTest extends React.Component {
  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Press some buttons</h3>
          <ActivityBar>
            <ActivityButton icon={<Icon />} label='Default' />
            <ActivityButton icon={<Icon />} label='Disabled' disabled={true} />
            <ActivityButton icon={<Icon />} label='Glowing' glowing={true} />
          </ActivityBar>
        </StyledCard>
      </Container>
    )
  }
}
