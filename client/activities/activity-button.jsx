import React from 'react'
import PropTypes from 'prop-types'
import styles from './activity-bar.css'

export default class ActivityButton extends React.Component {
  static propTypes = {
    label: PropTypes.string.isRequired,
    icon: PropTypes.element.isRequired,
    disabled: PropTypes.bool,
    onClick: PropTypes.func,
  }

  render() {
    const { label, icon, disabled, onClick } = this.props

    return (
      <button className={styles.button} disabled={disabled} onClick={onClick}>
        <div className={styles.buttonIcon}>
          {icon}
        </div>
        <span className={styles.buttonLabel}>
          {label}
        </span>
      </button>
    )
  }
}
