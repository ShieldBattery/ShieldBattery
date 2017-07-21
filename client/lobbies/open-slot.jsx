import React from 'react'
import PropTypes from 'prop-types'
import styles from './view.css'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'
import SlotActions from './slot-actions.jsx'
import SwapSlotsIcon from '../icons/material/ic_swap_vert_black_24px.svg'

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
        <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace} />
      ) : (
        <SelectedRace className={styles.slotRace} race={race} />
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

    return (
      <div className={styles.slot}>
        <div
          className={styles.slotLeftOpen}
          onMouseEnter={this.onLeftMouseEnter}
          onMouseLeave={this.onLeftMouseLeave}
          onClick={onSwitchClick}>
          <span className={styles.slotEmptyAvatar}>
            {this.state.isHovered ? <SwapSlotsIcon /> : null}
          </span>
          <span className={styles.slotEmptyName}>Open</span>
        </div>
        <div className={styles.slotRight}>
          {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
          {this.renderControls()}
        </div>
      </div>
    )
  }

  onLeftMouseEnter = () => {
    this.setState({ isHovered: true })
  }

  onLeftMouseLeave = () => {
    this.setState({ isHovered: false })
  }
}
