import PropTypes from 'prop-types'
import React from 'react'
import SwapSlotsIcon from '../icons/material/swap_vert-24px.svg'
import { RacePicker } from './race-picker'
import SelectedRace from './selected-race'
import { Slot, SlotEmptyAvatar, SlotEmptyName, SlotLeft, SlotProfileOpen, SlotRight } from './slot'
import { SlotActions } from './slot-actions'
import { useTranslation } from 'react-i18next'

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
    } = this.props
    const slotActions = []
    if (isHost) {
      slotActions.push(['Close slot', onCloseSlot])
      if (!controlledOpen && !isObserver && onAddComputer) {
        slotActions.push(['Add computer', onAddComputer])
      }
      if (canMakeObserver) {
        slotActions.push(['Make observer', onMakeObserver])
      }
      if (canRemoveObserver) {
        slotActions.push(['Make player', onRemoveObserver])
      }
    }
    const { t } = useTranslation()
    return (
      <Slot>
        <SlotLeft>
          <SlotProfileOpen
            onMouseEnter={this.onLeftMouseEnter}
            onMouseLeave={this.onLeftMouseLeave}
            onClick={onSwitchClick}>
            <SlotEmptyAvatar>{this.state.isHovered ? <SwapSlotsIcon /> : null}</SlotEmptyAvatar>
            <SlotEmptyName as='span'>{t('common.openText', 'Open')}</SlotEmptyName>
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
