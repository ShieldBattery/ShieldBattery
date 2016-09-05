import React, { PropTypes } from 'react'
import styles from './view.css'
import FlatButton from '../material/flat-button.jsx'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'

export default class EmptySlot extends React.Component {
  static propTypes = {
    onAddComputer: PropTypes.func,
    onSetRace: PropTypes.func,
    // Whether or not this slot can be modified (e.g. adding computer)
    controllable: PropTypes.bool,
    teamEmpty: PropTypes.bool,
    race: PropTypes.string,
  };

  renderControls() {
    const { controllable, teamEmpty, race, onAddComputer, onSetRace } = this.props
    if (!teamEmpty && !controllable) return null
    if (!teamEmpty) {
      return <FlatButton color='normal' label='Add computer' onClick={onAddComputer} />
    } else {
      return (controllable ?
          <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace}/> :
          <SelectedRace className={styles.slotRace} race={race} />)
    }
  }

  render() {
    return (<div className={styles.slot}>
      <div className={styles.slotLeft}>
        <span className={styles.slotEmptyAvatar}></span>
        <span className={styles.slotEmptyName}>Empty</span>
      </div>
      <div className={styles.slotRight}>
        { this.renderControls() }
      </div>
    </div>)
  }
}
