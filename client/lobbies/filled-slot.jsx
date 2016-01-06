import React, { PropTypes } from 'react'
import Avatar from '../avatars/avatar.jsx'
import styles from './view.css'
import FlatButton from '../material/flat-button.jsx'

export default class FilledSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string.isRequired,
    isComputer: PropTypes.bool,
    avatarImage: PropTypes.string,
    onSetRace: PropTypes.func,
  }

  render() {
    const { name, race, isComputer, avatarImage } = this.props

    return (<div className={styles.slot}>
      <Avatar user={name} image={avatarImage} className={styles.slotAvatar} />
      <span className={styles.slotName}>{name}</span>
      <FlatButton color='normal' label='Set race' onClick={this.props.onSetRace} />
      <span className={styles.slotRace}>{race}</span>
      <span className={styles.slotType}>{isComputer ? 'Computer' : 'Human'}</span>
    </div>)
  }
}
