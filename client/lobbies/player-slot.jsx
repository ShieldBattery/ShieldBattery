import React from 'react'
import PropTypes from 'prop-types'
import styles from './view.css'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import ComputerAvatar from '../avatars/computer-avatar.jsx'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'
import SlotActions from './slot-actions.jsx'

const StyledAvatar = styled(Avatar)`
  flex-grow: 0;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-right: 16px;
`

export default class PlayerSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string,
    isComputer: PropTypes.bool,
    avatarImage: PropTypes.string,
    onSetRace: PropTypes.func,
    onOpenSlot: PropTypes.func,
    onCloseSlot: PropTypes.func,
    onKickPlayer: PropTypes.func,
    onBanPlayer: PropTypes.func,
    // Whether or not this slot can be set race to
    canSetRace: PropTypes.bool,
    isHost: PropTypes.bool,
    // Whether or not this slot has slot actions
    hasSlotActions: PropTypes.bool,
    isObserver: PropTypes.bool,
    canMakeObserver: PropTypes.bool,
    canRemoveObserver: PropTypes.bool,
  }

  renderControls() {
    const { isObserver, canSetRace, race, onSetRace } = this.props
    if (isObserver) {
      return null
    }

    return canSetRace ? (
      <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace} />
    ) : (
      <SelectedRace className={styles.slotRace} race={race} />
    )
  }

  render() {
    const {
      name,
      isComputer,
      avatarImage,
      isHost,
      canMakeObserver,
      canRemoveObserver,
      hasSlotActions,
      onCloseSlot,
      onKickPlayer,
      onBanPlayer,
      onMakeObserver,
      onRemoveObserver,
    } = this.props
    const avatar = isComputer ? (
      <StyledAvatar as={ComputerAvatar} />
    ) : (
      <StyledAvatar user={name} image={avatarImage} />
    )
    const displayName = isComputer ? 'Computer' : name

    const slotActions = []
    if (isHost && hasSlotActions) {
      slotActions.push(['Close slot', onCloseSlot])
      if (!isComputer) {
        slotActions.push(['Kick player', onKickPlayer])
        slotActions.push(['Ban player', onBanPlayer])
      } else {
        slotActions.push(['Remove computer', onKickPlayer])
      }
      if (canMakeObserver) {
        slotActions.push(['Make observer', onMakeObserver])
      }
      if (canRemoveObserver) {
        slotActions.push(['Make player', onRemoveObserver])
      }
    }

    return (
      <div className={styles.slot}>
        <div className={styles.slotLeft}>
          <div className={styles.slotProfile}>
            {avatar}
            <span className={styles.slotName}>{displayName}</span>
          </div>
          {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
        </div>
        <div className={styles.slotRight}>{this.renderControls()}</div>
      </div>
    )
  }
}
