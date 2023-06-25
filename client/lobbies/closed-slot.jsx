import PropTypes from 'prop-types'
import React from 'react'
import { withTranslation } from 'react-i18next'
import { RacePicker } from './race-picker'
import SelectedRace from './selected-race'
import { Slot, SlotEmptyAvatar, SlotEmptyName, SlotLeft, SlotProfile, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

@withTranslation()
export default class slots extends React.Component {
  static propTypes = {
    onAddComputer: PropTypes.func,
    onSetRace: PropTypes.func,
    onOpenSlot: PropTypes.func,
    onMakeObserver: PropTypes.func,
    onRemoveObserver: PropTypes.func,
    // Indicates if this is a `controlledClosed` type slot
    controlledClosed: PropTypes.bool,
    // In `controlledClosed` slots, indicates if it can be set race to
    canSetRace: PropTypes.bool,
    isHost: PropTypes.bool,
    race: PropTypes.string,
    isObserver: PropTypes.bool,
    canMakeObserver: PropTypes.bool,
    canRemoveObserver: PropTypes.bool,
  }

  renderControls() {
    const { controlledClosed, canSetRace, race, onSetRace } = this.props
    if (controlledClosed) {
      return canSetRace ? (
        <RacePicker race={race} onSetRace={onSetRace} />
      ) : (
        <SelectedRace race={race} />
      )
    } else {
      return null
    }
  }

  render() {
    const {
      isHost,
      isObserver,
      canMakeObserver,
      canRemoveObserver,
      controlledClosed,
      onAddComputer,
      onOpenSlot,
      onMakeObserver,
      onRemoveObserver,
      t,
    } = this.props
    const slotActions = []
    if (isHost) {
      slotActions.push([t('lobbies.slots.openSlot', 'Open slot'), onOpenSlot])
      if (!controlledClosed && !isObserver && onAddComputer) {
        slotActions.push([t('lobbies.slots.addComputer', 'Add computer'), onAddComputer])
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
            <SlotEmptyAvatar />
            <SlotEmptyName as='span'>{t('lobbies.slots.name', 'Closed')}</SlotEmptyName>
          </SlotProfile>
          {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
        </SlotLeft>
        <SlotRight>{this.renderControls()}</SlotRight>
      </Slot>
    )
  }
}
