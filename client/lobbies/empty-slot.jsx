import React from 'react'
import styles from './view.css'

export default class EmptySlot extends React.Component {
  render() {
    return (<div className={styles.slot}>
      <span className={styles.slotEmptyAvatar}></span>
      <span className={styles.slotEmptyName}>Empty</span>
    </div>)
  }
}
