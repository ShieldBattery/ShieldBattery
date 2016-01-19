import React from 'react'
import classnames from 'classnames'
import Button from './button.jsx'
import FontIcon from './font-icon.jsx'
import styles from './button.css'

// A button that displays just an icon
export default class IconButton extends React.Component {
  static propTypes = {
    icon: React.PropTypes.string.isRequired,
  };

  render() {
    const classes = classnames(styles.iconButton, this.props.className)
    return (
      <Button {...this.props} className={classes} label={<FontIcon>{this.props.icon}</FontIcon>} />
    )
  }
}
