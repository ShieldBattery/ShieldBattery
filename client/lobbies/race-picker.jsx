import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './race-picker.css'

import Button from '../material/button.jsx'
import RaceIcon from './race-icon.jsx'

export default class RacePicker extends React.Component {
  static propTypes = {
    race: PropTypes.oneOf(['r', 'p', 't', 'z']).isRequired,
    onSetRace: PropTypes.func,
    className: PropTypes.string,
  }

  renderIcon(race) {
    const activeRace = this.props.race
    const classes = (race === activeRace ? `${styles.active} ` : '') + styles[race]
    const onClick = this.props.onSetRace ? () => this.props.onSetRace(race) : null

    return (
      <Button
        className={styles.button}
        onClick={onClick}
        label={<RaceIcon className={classes} race={race} />}
      />
    )
  }

  render() {
    const { className } = this.props
    const classes = classnames(styles.picker, className)
    return (
      <div className={classes}>
        {this.renderIcon('z')}
        {this.renderIcon('p')}
        {this.renderIcon('t')}
        {this.renderIcon('r')}
      </div>
    )
  }
}
