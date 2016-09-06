import React, { PropTypes } from 'react'
import styles from './view.css'
import FlatButton from '../material/flat-button.jsx'
import RacePicker from './race-picker.jsx'
import SelectedRace from './selected-race.jsx'
import FontIcon from '../material/font-icon.jsx'

export default class EmptySlot extends React.Component {
  static propTypes = {
    onAddComputer: PropTypes.func,
    onSetRace: PropTypes.func,
    onSwitchClick: PropTypes.func,
    // Whether or not this slot can be modified (e.g. adding computer)
    controllable: PropTypes.bool,
    teamEmpty: PropTypes.bool,
    race: PropTypes.string,
  };

  state = {
    isHovered: false,
  };

  renderControls() {
    const { controllable, teamEmpty, race, onAddComputer, onSetRace } = this.props
    if (!teamEmpty && !controllable) return null
    if (!teamEmpty) {
      return <FlatButton color='normal' label='Add computer' onClick={onAddComputer} />
    } else {
      return (controllable ?
          <RacePicker className={styles.slotRace} race={race} onSetRace={onSetRace}/> :
          <SelectedRace className={styles.slotRace} race={race} />)
    }
  }

  render() {
    return (<div className={styles.slot}>
      <div className={styles.slotLeftEmpty}
        onMouseEnter={this.onLeftMouseEnter} onMouseLeave={this.onLeftMouseLeave}
        onClick={this.props.onSwitchClick}>
        <span className={styles.slotEmptyAvatar}>
          {
            this.state.isHovered ?
                <FontIcon>swap_vert</FontIcon> :
                null
          }
        </span>
        <span className={styles.slotEmptyName}>Empty</span>
      </div>
      <div className={styles.slotRight}>
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
