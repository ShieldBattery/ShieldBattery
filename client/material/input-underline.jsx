import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './input-underline.css'

const InputUnderline = props => {
  const classes = classnames(styles.container, {
    [styles.focused]: props.focused,
    [styles.error]: props.error,
    [styles.disabled]: props.disabled,
  })
  return (
    <div className={classes}>
      <hr className={styles.underline} />
      <hr className={styles.focusUnderline} />
    </div>
  )
}

InputUnderline.propTypes = {
  focused: PropTypes.bool,
  error: PropTypes.bool,
  disabled: PropTypes.bool,
}

export default InputUnderline
