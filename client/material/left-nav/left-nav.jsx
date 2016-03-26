import React from 'react'
import styles from './left-nav.css'

import LogoText from '../../logos/logotext-188x30.svg'

export default function LeftNav(props) {
  const footer = props.footer ? <div className={styles.footer}>{props.footer}</div> : undefined
  return (<nav className={styles.leftNav}>
    <div className={styles.logo}><LogoText /></div>
    <div className={styles.sections}>
      {props.children}
    </div>
    { footer }
  </nav>)
}

LeftNav.propTypes = {
  footer: React.PropTypes.node,
}
