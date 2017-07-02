import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './race-icon.css'

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
    race: PropTypes.oneOf(['r', 'p', 't', 'z']).isRequired,
    className: PropTypes.string,
    style: PropTypes.string,
  }

  render() {
    const classes = classnames(styles[this.props.race], this.props.className)
    const icon = ICONS[this.props.race]
    return (
      <i className={classes} style={this.props.style}>
        {icon}
      </i>
    )
  }
}
