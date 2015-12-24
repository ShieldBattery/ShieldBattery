import React from 'react'
import styles from './left-nav.css'

export default function LeftNav(props) {
  return (<nav className={styles.leftNav}>
    <div className={styles.logo}>
      <h3 className={styles.logoTextLight}>Shield</h3>
      <h3 className={styles.logoTextMedium}>Battery</h3>
    </div>
    {props.children}
  </nav>)
}
