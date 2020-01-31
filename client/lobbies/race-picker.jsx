import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Button from '../material/button.jsx'
import RaceIcon from './race-icon.jsx'

import { fastOutSlowIn } from '../material/curve-constants'
import { colorTextFaint } from '../styles/colors'

export const RaceButton = styled(Button)`
  display: inline-block;
  vertical-align: middle;
  width: 36px;
  height: 36px;
  min-height: 32px;
  padding: 2px;
  border-radius: 50%;

  &:not(:first-child) {
    margin-left: 4px;
  }

  &:hover,
  &:active {
    background-color: transparent;
  }
`

export const StyledRaceIcon = styled(RaceIcon)`
  display: inline-block;
  width: 32px;
  height: 32px;
  margin: auto;
  overflow: hidden;
  transition: color 150ms ${fastOutSlowIn};

  & svg {
    width: 32px;
    height: 32px;
  }

  ${props => {
    let color
    if (props.race === 'z') {
      color = '#FF1744'
    } else if (props.race === 'p') {
      color = '#00E676'
    } else if (props.race === 't') {
      color = '#2979FF'
    } else if (props.race === 'r') {
      color = '#FF9100'
    }

    return `
      color: ${props.active ? color : colorTextFaint};

      &:hover,
      &:active {
        color: ${color};
      }
    `
  }}
`

export default class RacePicker extends React.Component {
  static propTypes = {
    race: PropTypes.oneOf(['r', 'p', 't', 'z']).isRequired,
    onSetRace: PropTypes.func,
  }

  renderIcon(race) {
    const activeRace = this.props.race
    const onClick = this.props.onSetRace ? () => this.props.onSetRace(race) : null

    return (
      <RaceButton
        onClick={onClick}
        label={<StyledRaceIcon active={race === activeRace} race={race} />}
      />
    )
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
