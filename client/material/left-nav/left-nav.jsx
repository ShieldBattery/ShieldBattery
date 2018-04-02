import React from 'react'
import PropTypes from 'prop-types'
import styles from './left-nav.css'

function LeftNav(props) {
  const footer = props.footer ? <div className={styles.footer}>{props.footer}</div> : undefined
  return (
    <nav className={styles.leftNav}>
      <div className={styles.sections}>{props.children}</div>
      {footer}
    </nav>
  )
}

LeftNav.propTypes = {
  footer: PropTypes.node,
}

export default LeftNav
