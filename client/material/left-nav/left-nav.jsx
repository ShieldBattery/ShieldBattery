import React from 'react'
import styles from './left-nav.css'

export default function LeftNav(props) {
  const footer = props.footer ? <div className={styles.footer}>{props.footer}</div> : undefined
  return (<nav className={styles.leftNav}>
    <div className={styles.logo}>
      <h3 className={styles.logoTextLight}>Shield</h3>
      <h3 className={styles.logoTextMedium}>Battery</h3>
    </div>
    <div className={styles.sections}>
      {props.children}
    </div>
    { footer }
  </nav>)
}

LeftNav.propTypes = {
  footer: React.PropTypes.node,
}
