import React, { PropTypes } from 'react'
import classnames from 'classnames'
import styles from './avatar.css'

import PlaceholderIcon from './avatar-placeholder.svg'

export default class Avatar extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    image: PropTypes.string,
  };

  render() {
    const classes = classnames(styles.avatarImage, this.props.className)
    if (this.props.image) {
      return <img {...this.props} className={classes} src={this.props.image} />
    }

    return <i {...this.props} className={classes}><PlaceholderIcon /></i>
  }
}
