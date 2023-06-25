import PropTypes from 'prop-types'
import React from 'react'
import { withTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Avatar } from '../avatars/avatar'
import ComputerAvatar from '../avatars/computer-avatar'
import { RacePicker } from './race-picker'
import SelectedRace from './selected-race'
import { Slot, SlotLeft, SlotName, SlotProfile, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

const StyledAvatar = styled(Avatar)`
  flex-grow: 0;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin-right: 16px;
`

@withTranslation()
export default class PlayerSlot extends React.Component {
  static propTypes = {
    name: PropTypes.string.isRequired,
    race: PropTypes.string,
    isComputer: PropTypes.bool,
    onSetRace: PropTypes.func,
    onOpenSlot: PropTypes.func,
    onCloseSlot: PropTypes.func,
    onKickPlayer: PropTypes.func,
    onBanPlayer: PropTypes.func,
    // Whether or not this slot can be set race to
    canSetRace: PropTypes.bool,
    isHost: PropTypes.bool,
    // Whether or not this slot is the current user's own slot
    isSelf: PropTypes.bool,
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
      <RacePicker race={race} onSetRace={onSetRace} />
    ) : (
      <SelectedRace race={race} />
    )
  }

  render() {
    const {
      name,
      isComputer,
      isHost,
      canMakeObserver,
      canRemoveObserver,
      isSelf,
      onCloseSlot,
      onKickPlayer,
      onBanPlayer,
      onMakeObserver,
      onRemoveObserver,
      t,
    } = this.props
    const avatar = isComputer ? <StyledAvatar as={ComputerAvatar} /> : <StyledAvatar user={name} />
    const displayName = isComputer ? t('game.playerName.computer', 'Computer') : name

    const slotActions = []
    if (isHost) {
      if (!isSelf) {
        slotActions.push([t('lobbies.slots.closeSlot', 'Close slot'), onCloseSlot])
        if (!isComputer) {
          slotActions.push([t('lobbies.slots.kickPlayer', 'Kick player'), onKickPlayer])
          slotActions.push([t('lobbies.slots.banPlayer', 'Ban player'), onBanPlayer])
        } else {
          slotActions.push([t('lobbies.slots.removeComputer', 'Remove computer'), onKickPlayer])
        }
      }

      if (canMakeObserver) {
        slotActions.push([t('lobbies.slots.makeObserver', 'Make observer'), onMakeObserver])
      }
      if (canRemoveObserver) {
        slotActions.push([t('lobbies.slots.makePlayer', 'Make player'), onRemoveObserver])
      }
    }

    return (
      <Slot>
        <SlotLeft>
          <SlotProfile>
            {avatar}
            <SlotName as='span'>{displayName}</SlotName>
          </SlotProfile>
          {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
        </SlotLeft>
        <SlotRight>{this.renderControls()}</SlotRight>
      </Slot>
    )
  }
}
