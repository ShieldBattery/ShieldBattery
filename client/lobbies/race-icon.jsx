import React, { PropTypes } from 'react'

import RandomIcon from '../icons/material/ic_casino_black_24px.svg'
import ProtossIcon from '../icons/starcraft/zealot_24px.svg'
import TerranIcon from '../icons/starcraft/marine_24px.svg'
import ZergIcon from '../icons/starcraft/hydra_24px.svg'

const ICONS = {
  r: <RandomIcon />,
  p: <ProtossIcon />,
  t: <TerranIcon />,
  z: <ZergIcon />,
}

export default class RaceIcon extends React.Component {
  static propTypes = {
    race: PropTypes.string.isRequired,
    className: PropTypes.string,
    style: PropTypes.string,
  };

  render() {
    const race = this.props.race.toLowerCase()
    const icon = ICONS.hasOwnProperty(race) ? ICONS[race] : null
    return <i className={this.props.className} style={this.props.style}>{icon}</i>
  }
}
