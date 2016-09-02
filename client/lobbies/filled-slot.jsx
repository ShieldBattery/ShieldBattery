import React, { PropTypes } from 'react'
import styles from './view.css'

import Avatar from '../avatars/avatar.jsx'
import ComputerAvatar from '../avatars/computer-avatar.jsx'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'

export default class FilledSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string.isRequired,
    isComputer: PropTypes.bool,
    avatarImage: PropTypes.string,
    onSetRace: PropTypes.func,
    // Whether or not this slot can be modified (e.g. changing race)
    controllable: PropTypes.bool,
  };

  render() {
    const { name, race, isComputer, avatarImage, controllable, onSetRace } = this.props
    const avatar = isComputer ?
        <ComputerAvatar className={styles.slotAvatar} /> :
        <Avatar user={name} image={avatarImage} className={styles.slotAvatar} />
    const displayName = isComputer ? 'Computer' : name

    const raceElem = controllable ?
        <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace}/> :
        <SelectedRace className={styles.slotRace} race={race} />

    return (<div className={styles.slot}>
      <div className={styles.slotLeft}>
        {avatar}
        <span className={styles.slotName}>{displayName}</span>
      </div>
      <div className={styles.slotRight}>
        {raceElem}
      </div>
    </div>)
  }
}
