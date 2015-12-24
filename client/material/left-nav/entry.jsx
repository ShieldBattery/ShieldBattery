import React from 'react'
import styles from './left-nav.css'

const Entry = (props) => {
  const classes = props.active ? styles.active : styles.entry
  return <li className={classes}>{props.children}</li>
}
Entry.propTypes = {
  active: React.PropTypes.bool,
}

export default Entry
