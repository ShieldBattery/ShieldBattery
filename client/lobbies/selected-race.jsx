import React, { PropTypes } from 'react'
import classnames from 'classnames'
import styles from './race-picker.css'

import Button from '../material/button.jsx'
import RaceIcon from './race-icon.jsx'

// Like a RacePicker, but for uncontrollable slots
export default class SelectedRace extends React.Component {
  static propTypes = {
    race: PropTypes.oneOf([ 'r', 'p', 't', 'z' ]).isRequired,
    className: PropTypes.string,
  };


  renderIcon(race) {
    if (this.props.race === race) {
      return (
        <Button className={styles.button} disabled={true}
            label={<RaceIcon className={`${styles.active} ${styles[race]}`} race={race} />} />
      )
    } else {
      return <span className={styles.deselected}></span>
    }
  }

  render() {
    const classes = classnames(styles.picker, this.props.className)
    return (<div className={classes}>
      { this.renderIcon('z') }
      { this.renderIcon('p') }
      { this.renderIcon('t') }
      { this.renderIcon('r') }
    </div>)
  }
}
