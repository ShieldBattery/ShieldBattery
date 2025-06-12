import { Component } from 'react'
import styled from 'styled-components'
import { Card } from '../../material/card'
import { RacePicker } from '../race-picker'
import { SelectedRace } from '../selected-race'

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
  background-color: var(--theme-container-low);
`

export default class RacePickerTest extends Component {
  state = {
    race: 'z',
  }

  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Choose a race</h3>
          <RacePicker race={this.state.race} onSetRace={race => this.setState({ race })} />
          <SelectedRace race={this.state.race} />
        </StyledCard>
      </Container>
    )
  }
}
