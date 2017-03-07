import React, { PropTypes } from 'react'
import styles from './view.css'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'
import SlotActions from './slot-actions.jsx'

export default class ClosedSlot extends React.Component {
  static propTypes = {
    onAddComputer: PropTypes.func,
    onSetRace: PropTypes.func,
    onOpenSlot: PropTypes.func,
    // Indicates if this is a `controlledClosed` type slot
    controlledClosed: PropTypes.bool,
    // In `controlledClosed` slots, indicates if it can be set race to
    canSetRace: PropTypes.bool,
    isHost: PropTypes.bool,
    race: PropTypes.string,
  };

  renderControls() {
    const { controlledClosed, canSetRace, race, onSetRace } = this.props
    if (controlledClosed) {
      return (canSetRace ?
          <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace}/> :
          <SelectedRace className={styles.slotRace} race={race} />)
    } else {
      return null
    }
  }

  render() {
    const { isHost, controlledClosed, onAddComputer, onOpenSlot } = this.props
    const slotActions = []
    if (isHost) {
      if (!controlledClosed) {
        slotActions.push(['Add computer', onAddComputer])
      }
      slotActions.push(['Open slot', onOpenSlot])
    }

    return (<div className={styles.slot}>
      <div className={styles.slotLeft}>
        <span className={styles.slotEmptyAvatar}></span>
        <span className={styles.slotEmptyName}>Closed</span>
      </div>
      <div className={styles.slotRight}>
        {
          slotActions.length > 0 ?
              <SlotActions slotActions={slotActions} /> :
              <div></div>
        }
        { this.renderControls() }
      </div>
    </div>)
  }
}
