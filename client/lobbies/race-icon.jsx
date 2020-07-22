import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import RandomIcon from '../icons/material/ic_casino_black_24px.svg'
import ProtossIcon from '../icons/starcraft/zealot_24px.svg'
import TerranIcon from '../icons/starcraft/marine_24px.svg'
import ZergIcon from '../icons/starcraft/hydra_24px.svg'

const ICONS = {
  r: RandomIcon,
  p: ProtossIcon,
  t: TerranIcon,
  z: ZergIcon,
}

const StyledIcon = styled.svg`
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

    return `fill: ${color};`
  }}
`

export default class RaceIcon extends React.Component {
  static propTypes = {
    race: PropTypes.oneOf(['r', 'p', 't', 'z']).isRequired,
  }

  render() {
    const icon = ICONS[this.props.race]
    return <StyledIcon className={this.props.className} as={icon} race={this.props.race} />
  }
}
