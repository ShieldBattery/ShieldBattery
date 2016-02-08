import React, { PropTypes } from 'react'
import classnames from 'classnames'
import styles from './input-label.css'

const Label = props => {
  const classes = classnames(styles.label, {
    [styles.hasValue]: props.hasValue,
  })
  return <label className={classes} htmlFor={props.htmlFor}>{props.text}</label>
}

Label.propTypes = {
  text: PropTypes.string.isRequired,
  htmlFor: PropTypes.string,
  hasValue: PropTypes.bool,
}

export default Label
