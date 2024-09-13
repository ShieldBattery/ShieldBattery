import React from 'react'
import { styled } from 'styled-components'
import Card from '../../material/card.js'
import { background500 } from '../../styles/colors.js'
import { RacePicker } from '../race-picker.js'
import SelectedRace from '../selected-race.js'

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
  background-color: ${background500};
`

export default class RacePickerTest extends React.Component {
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
