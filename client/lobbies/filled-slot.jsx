import React, { PropTypes } from 'react'
import styles from './view.css'

import Avatar from '../avatars/avatar.jsx'
import ComputerAvatar from '../avatars/computer-avatar.jsx'
import FlatButton from '../material/flat-button.jsx'
import RaceIcon from './race-icon.jsx'

export default class FilledSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string.isRequired,
    isComputer: PropTypes.bool,
    avatarImage: PropTypes.string,
    onSetRace: PropTypes.func,
  };

  render() {
    const { name, race, isComputer, avatarImage } = this.props
    const avatar = isComputer ?
        <ComputerAvatar className={styles.slotAvatar} /> :
        <Avatar user={name} image={avatarImage} className={styles.slotAvatar} />
    const displayName = isComputer ? 'Computer' : name

    return (<div className={isComputer ? styles.computerSlot : styles.slot}>
      {avatar}
      <span className={styles.slotName}>{displayName}</span>
      <FlatButton color='normal' label='Set race' onClick={this.props.onSetRace} />
      <RaceIcon className={styles.slotRace} race={race} />
    </div>)
  }
}
