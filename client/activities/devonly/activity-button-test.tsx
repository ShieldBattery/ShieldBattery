import React from 'react'
import styled from 'styled-components'
import Icon from '../../icons/material/baseline-check_circle-24px.svg'
import Card from '../../material/card'
import { background700 } from '../../styles/colors'
import ActivityBar from '../activity-bar'
import { ActivityButton } from '../activity-button'

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
            <ActivityButton icon={<Icon />} label='Default' />
            <ActivityButton icon={<Icon />} label='Disabled' disabled={true} />
            <ActivityButton icon={<Icon />} label='Glowing' glowing={true} />
            <ActivityButton icon={<Icon />} label='Count' count={27} />
            <ActivityButton icon={<Icon />} label='CountGlow' glowing={true} count={666} />
          </ActivityBar>
        </StyledCard>
      </Container>
    )
  }
}
