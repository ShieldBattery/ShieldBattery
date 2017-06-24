import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './input-floating-label.css'

const FloatingLabel = props => {
  const classes = classnames(styles.label, {
    [styles.hasValue]: props.hasValue,
    [styles.focused]: props.focused,
    [styles.error]: props.error,
    [styles.disabled]: props.disabled,
  })
  return <label className={classes} htmlFor={props.htmlFor}>{props.text}</label>
}

FloatingLabel.propTypes = {
  text: PropTypes.string.isRequired,
  htmlFor: PropTypes.string,
  hasValue: PropTypes.bool,
  focused: PropTypes.bool,
  error: PropTypes.bool,
  disabled: PropTypes.bool,
}

export default FloatingLabel
