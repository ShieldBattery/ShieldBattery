import React, { PropTypes } from 'react'
import styles from './menu.css'

const MenuBackdrop = (props) => <div className={styles.backdrop} onClick={props.onClick} />
MenuBackdrop.propTypes = {
  onClick: PropTypes.func,
}

export default MenuBackdrop
