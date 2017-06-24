import React from 'react'
import PropTypes from 'prop-types'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from './input-error.css'

const InputError = props => {
  const errorText = props.error ?
    <div className={styles.error} key='error'>{props.error}</div> : null
  return (
    <TransitionGroup
      transitionName={{
        enter: styles.enter,
        enterActive: styles.enterActive,
        leave: styles.leave,
        leaveActive: styles.leaveActive,
      }}
      className={styles.container}
      transitionEnterTimeout={250}
      transitionLeaveTimeout={250}>
      {errorText}
    </TransitionGroup>
  )
}

InputError.propTypes = {
  error: PropTypes.string,
}

export default InputError
