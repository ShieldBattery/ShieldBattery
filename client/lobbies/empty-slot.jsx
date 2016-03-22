import React from 'react'
import styles from './view.css'
import FlatButton from '../material/flat-button.jsx'

export default class EmptySlot extends React.Component {
  static propTypes = {
    onAddComputer: React.PropTypes.func,
    // Whether or not this slot can be modified (e.g. changing race)
    controllable: React.PropTypes.bool,
  };

  render() {
    return (<div className={styles.slot}>
      <span className={styles.slotEmptyAvatar}></span>
      <span className={styles.slotEmptyName}>Empty</span>
      { !this.props.controllable ? null :
          <FlatButton color='normal' label='Add computer' onClick={this.props.onAddComputer} /> }
    </div>)
  }
}
