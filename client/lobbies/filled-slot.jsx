import React, { PropTypes } from 'react'
import Avatar from '../avatars/avatar.jsx'
import styles from './view.css'

export default class FilledSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string.isRequired,
    isComputer: PropTypes.bool,
    avatarImage: PropTypes.string,
  }

  render() {
    const { name, race, isComputer, avatarImage } = this.props

    return (<div className={styles.slot}>
      <Avatar user={name} image={avatarImage} className={styles.slotAvatar} />
      <span className={styles.slotName}>{name}</span>
      <span className={styles.slotRace}>{race}</span>
      <span className={styles.slotType}>{isComputer ? 'Computer' : 'Human'}</span>
    </div>)
  }
}
