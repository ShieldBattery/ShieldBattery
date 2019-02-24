import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import Button from './button.jsx'
import styles from './button.css'

// A button with no elevation
export default class FlatButton extends React.Component {
  static propTypes = {
    ...Button.propTypes,
    color: PropTypes.oneOf(['primary', 'accent', 'normal']),
  }

  render() {
    const classes = classnames(styles.flat, this.props.className, {
      [styles.primary]: this.props.color === 'primary',
      [styles.accent]: this.props.color === 'accent',
    })

    return <Button ref='button' {...this.props} className={classes} />
  }

  focus() {
    this.refs.button.focus()
  }

  blur() {
    this.refs.button.blur()
  }
}
