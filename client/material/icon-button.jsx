import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import Button from './button.jsx'
import styles from './button.css'

// A button that displays just an SVG icon
export default class IconButton extends React.Component {
  static propTypes = {
    icon: PropTypes.element.isRequired,
  }

  render() {
    const { className, icon, ...otherProps } = this.props
    const classes = classnames(styles.iconButton, className)
    return <Button {...otherProps} className={classes} label={icon} />
  }
}
