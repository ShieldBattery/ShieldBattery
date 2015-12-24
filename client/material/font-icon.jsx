import React from 'react'
import styles from './font-icon.css'

class FontIcon extends React.Component {
  render() {
    let classes = 'material-icons'
    if (this.props.size) {
      const sizeClass = 'icon' + this.props.size
      if (!styles[sizeClass]) {
        throw new Error(`invalid icon size: ${this.props.size}`)
      }
      classes += ' ' + sizeClass
    }

    return <i className={classes}>{this.props.children}</i>
  }
}

FontIcon.propTypes = {
  size: React.PropTypes.number,
}

export default FontIcon
