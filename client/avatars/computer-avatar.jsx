import React from 'react'
import classnames from 'classnames'
import styles from './avatar.css'

import ComputerIcon from '../icons/material/ic_memory_black_24px.svg'

export default props => {
  const classes = classnames(styles.avatarImage, props.className)
  return <i {...props} className={classes}><ComputerIcon /></i>
}
