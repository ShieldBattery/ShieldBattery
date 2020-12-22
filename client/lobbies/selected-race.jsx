import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { RaceButton, StyledRaceIcon } from './race-picker.jsx'

import { colorDividers } from '../styles/colors.ts'

const Deselected = styled.span`
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

  renderIcon(race) {
    if (this.props.race === race) {
      return <RaceButton disabled={true} label={<StyledRaceIcon active={true} race={race} />} />
    } else {
      return <Deselected />
    }
  }

  render() {
    return (
      <div className={this.props.className}>
        {this.renderIcon('z')}
        {this.renderIcon('p')}
        {this.renderIcon('t')}
        {this.renderIcon('r')}
      </div>
    )
  }
}
