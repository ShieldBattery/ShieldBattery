import React from 'react'
import PropTypes from 'prop-types'
import styles from './view.css'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'
import SlotActions from './slot-actions.jsx'

export default class ClosedSlot extends React.Component {
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
      controlledClosed,
      onAddComputer,
      onOpenSlot,
      onMakeObserver,
      onRemoveObserver,
    } = this.props
    const slotActions = []
    if (isHost) {
      slotActions.push(['Open slot', onOpenSlot])
      if (!controlledClosed && !isObserver && onAddComputer) {
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
        <div className={styles.slotLeft}>
          <div className={styles.slotProfile}>
            <span className={styles.slotEmptyAvatar} />
            <span className={styles.slotEmptyName}>Closed</span>
          </div>
          {slotActions.length > 0 ? <SlotActions slotActions={slotActions} /> : <div />}
        </div>
        <div className={styles.slotRight}>{this.renderControls()}</div>
      </div>
    )
  }
}
