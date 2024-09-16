import PropTypes from 'prop-types'
import React from 'react'
import { RacePicker } from './race-picker.js'

// Like a RacePicker, but for uncontrollable slots
export default class SelectedRace extends React.Component {
  static propTypes = {
    race: PropTypes.oneOf(['r', 'p', 't', 'z']).isRequired,
  }

  render() {
    const hiddenRaces = ['r', 'p', 't', 'z'].filter(race => race !== this.props.race)

    return <RacePicker race={this.props.race} hiddenRaces={hiddenRaces} allowInteraction={false} />
  }
}
