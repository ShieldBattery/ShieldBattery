import React from 'react'
import classnames from 'classnames'
import Button from './button.jsx'
import styles from './button.css'

// A button that displays just an SVG icon
export default class IconButton extends React.Component {
  static propTypes = {
    icon: React.PropTypes.element.isRequired,
  };

  render() {
    const { className, icon } = this.props
    const classes = classnames(styles.iconButton, className)
    return (
      <Button {...this.props} className={classes} label={icon} />
    )
  }
}
