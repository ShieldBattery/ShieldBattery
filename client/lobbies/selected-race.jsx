import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import RacePicker from './race-picker'

import { colorDividers } from '../styles/colors'

export const HiddenRaceIcon = styled.span`
  position: relative;
  display: inline-block;
  vertical-align: middle;
  width: 36px;
  height: 36px;
  min-height: 32px;
  padding: 2px;

  &:not(:first-child) {
    margin-left: 4px;
  }

  &::after {
    content: '';
    position: absolute;
    left: calc(50% - 6px);
    top: calc(50% - 6px);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: ${colorDividers};
  }
`

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
