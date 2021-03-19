import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Button from '../material/button'
import RaceIcon from './race-icon'

import { fastOutSlowIn } from '../material/curve-constants'
import { colorTextFaint, colorDividers } from '../styles/colors'

export const RACE_PICKER_SIZE_MEDIUM = 'MEDIUM'
export const RACE_PICKER_SIZE_LARGE = 'LARGE'

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

  ${props => {
    if (props.size === RACE_PICKER_SIZE_LARGE) {
      return `
        width: 48px;
        height: 48px;
        min-height: 44px;
      `
    }

    return ''
  }};
`

export const StyledRaceIcon = styled(RaceIcon)`
  display: inline-block;
  width: 32px;
  height: 32px;
  margin: auto;
  overflow: hidden;
  transition: fill 150ms ${fastOutSlowIn};

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
      fill: ${props.active ? color : colorTextFaint};

      &:hover,
      &:active {
        fill: ${color};
      }
    `
  }}

  ${props => {
    if (props.size === RACE_PICKER_SIZE_LARGE) {
      return `
        width: 44px;
        height: 44px;
      `
    }

    return ''
  }};
`

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

export default class RacePicker extends React.Component {
  static propTypes = {
    race: PropTypes.oneOf(['r', 'p', 't', 'z']).isRequired,
    disableRace: PropTypes.oneOf(['r', 'p', 't', 'z']),
    size: PropTypes.oneOf([RACE_PICKER_SIZE_MEDIUM, RACE_PICKER_SIZE_LARGE]),
    allowRandom: PropTypes.bool,
    onSetRace: PropTypes.func,
  }

  static defaultProps = {
    disableRace: null, 
    size: RACE_PICKER_SIZE_MEDIUM,
    allowRandom: true,
  }

  renderIcon(race) {
    const { size, disableRace } = this.props
    const activeRace = this.props.race
    const onClick = this.props.onSetRace ? () => this.props.onSetRace(race) : null

    return (
      race !== disableRace ?
      <RaceButton
        label={<StyledRaceIcon active={race === activeRace} race={race} size={size} />}
        size={size}
        onClick={onClick}
      /> :
      <Deselected />
    )
  }

  render() {
    return (
      <div className={this.props.className}>
        {this.renderIcon('z')}
        {this.renderIcon('p')}
        {this.renderIcon('t')}
        {this.props.allowRandom ? this.renderIcon('r') : null}
      </div>
    )
  }
}
