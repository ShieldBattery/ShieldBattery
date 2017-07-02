import React from 'react'
import styles from './dots.css'

export default class DotsIndicator extends React.Component {
  render() {
    return (
      <div className={styles.progress}>
        <div className={styles.dot1} />
        <div className={styles.dot2} />
        <div className={styles.dot3} />
        <div className={styles.dot4} />
      </div>
    )
  }
}
