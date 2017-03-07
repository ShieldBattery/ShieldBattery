import React, { PropTypes } from 'react'
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
  };

  state = {
    isHovered: false,
  };

  renderControls() {
    const { controlledOpen, canSetRace, race, onSetRace } = this.props
    if (controlledOpen) {
      return (canSetRace ?
          <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace}/> :
          <SelectedRace className={styles.slotRace} race={race} />)
    } else {
      return null
    }
  }

  render() {
    const { isHost, controlledOpen, onAddComputer, onSwitchClick, onCloseSlot } = this.props
    const slotActions = []
    if (isHost) {
      if (!controlledOpen) {
        slotActions.push(['Add computer', onAddComputer])
      }
      slotActions.push(['Close slot', onCloseSlot])
    }

    return (<div className={styles.slot}>
      <div className={styles.slotLeftOpen}
        onMouseEnter={this.onLeftMouseEnter} onMouseLeave={this.onLeftMouseLeave}
        onClick={onSwitchClick}>
        <span className={styles.slotEmptyAvatar}>
          {
            this.state.isHovered ?
                <SwapSlotsIcon /> :
                null
          }
        </span>
        <span className={styles.slotEmptyName}>Open</span>
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

  onLeftMouseEnter = () => {
    this.setState({ isHovered: true })
  };

  onLeftMouseLeave = () => {
    this.setState({ isHovered: false })
  };
}
