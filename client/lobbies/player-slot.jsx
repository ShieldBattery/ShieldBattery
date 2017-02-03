import React, { PropTypes } from 'react'
import styles from './view.css'

import Avatar from '../avatars/avatar.jsx'
import ComputerAvatar from '../avatars/computer-avatar.jsx'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'
import SlotActions from './slot-actions.jsx'

export default class PlayerSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string.isRequired,
    isComputer: PropTypes.bool,
    avatarImage: PropTypes.string,
    onSetRace: PropTypes.func,
    onOpenSlot: PropTypes.func,
    onCloseSlot: PropTypes.func,
    onKickPlayer: PropTypes.func,
    onBanPlayer: PropTypes.func,
    onRemoveComputer: PropTypes.func,
    // Whether or not this slot can be set race to
    canSetRace: PropTypes.bool,
    isHost: PropTypes.bool,
    // Whether or not this slot has slot actions
    hasSlotActions: PropTypes.bool,
  };

  render() {
    const {
      name,
      race,
      isComputer,
      avatarImage,
      canSetRace,
      isHost,
      hasSlotActions,
      onSetRace,
      onCloseSlot,
      onKickPlayer,
      onBanPlayer,
      onRemoveComputer,
    } = this.props
    const avatar = isComputer ?
        <ComputerAvatar className={styles.slotAvatar} /> :
        <Avatar user={name} image={avatarImage} className={styles.slotAvatar} />
    const displayName = isComputer ? 'Computer' : name

    // TODO(2Pac): Figure out the best ordering for these actions
    const slotActions = []
    if (isHost && hasSlotActions) {
      if (!isComputer) {
        slotActions.push(['Kick player', onKickPlayer])
        slotActions.push(['Ban player', onBanPlayer])
      } else {
        slotActions.push(['Remove computer', onRemoveComputer])
      }
      slotActions.push(['Close slot', onCloseSlot])
    }

    const raceElem = canSetRace ?
        <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace}/> :
        <SelectedRace className={styles.slotRace} race={race} />

    return (<div className={styles.slot}>
      <div className={styles.slotLeft}>
        {avatar}
        <span className={styles.slotName}>{displayName}</span>
      </div>
      <div className={styles.slotRight}>
        {
          slotActions.length > 0 ?
              <SlotActions slotActions={slotActions} /> :
              <div></div>
        }
        {raceElem}
      </div>
    </div>)
  }
}
