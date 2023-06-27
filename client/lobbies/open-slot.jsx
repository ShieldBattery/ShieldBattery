import PropTypes from 'prop-types'
import React from 'react'
import { withTranslation } from 'react-i18next'
import { MaterialIcon } from '../icons/material/material-icon'
import { RacePicker } from './race-picker'
import SelectedRace from './selected-race'
import { Slot, SlotEmptyAvatar, SlotEmptyName, SlotLeft, SlotProfileOpen, SlotRight } from './slot'
import { SlotActions } from './slot-actions'

@withTranslation()
export default class OpenSlot extends React.Component {
  static propTypes = {
    onAddComputer: PropTypes.func,
    onSetRace: PropTypes.func,
    onSwitchClick: PropTypes.func,
    onCloseSlot: PropTypes.func,
    // Indicates if this is a `controlledOpen` type slot
    controlledOpen: PropTypes.bool,
    // In `controlledOpen` slots, indicates if it can be set race to
    canSetRace: PropTypes.bool,
    isHost: PropTypes.bool,
    race: PropTypes.string,
    isObserver: PropTypes.bool,
    canMakeObserver: PropTypes.bool,
    canRemoveObserver: PropTypes.bool,
  }

  state = {
    isHovered: false,
  }

  renderControls() {
    const { controlledOpen, canSetRace, race, onSetRace } = this.props
    if (controlledOpen) {
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
      controlledOpen,
      onAddComputer,
      onSwitchClick,
      onCloseSlot,
      onMakeObserver,
      onRemoveObserver,
      t,
    } = this.props
    const slotActions = []
    if (isHost) {
      slotActions.push([t('lobbies.slots.closeSlot', 'Close slot'), onCloseSlot])
      if (!controlledOpen && !isObserver && onAddComputer) {
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
          <SlotProfileOpen
            onMouseEnter={this.onLeftMouseEnter}
            onMouseLeave={this.onLeftMouseLeave}
            onClick={onSwitchClick}>
            <SlotEmptyAvatar>
              {this.state.isHovered ? <MaterialIcon icon='swap_vert' /> : null}
            </SlotEmptyAvatar>
            <SlotEmptyName as='span'>{t('lobbies.slots.open', 'Open')}</SlotEmptyName>
          </SlotProfileOpen>
          {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
        </SlotLeft>
        <SlotRight>{this.renderControls()}</SlotRight>
      </Slot>
    )
  }

  onLeftMouseEnter = () => {
    this.setState({ isHovered: true })
  }

  onLeftMouseLeave = () => {
    this.setState({ isHovered: false })
  }
}
