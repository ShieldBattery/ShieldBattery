import React, { PropTypes } from 'react'
import classnames from 'classnames'
import styles from './avatar.css'
import { randomColorForString } from './colors'

import PlaceholderIcon from './avatar-placeholder.svg'

export default class Avatar extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    image: PropTypes.string,
  };

  render() {
    const { className, image, user, ...otherProps } = this.props
    const classes = classnames(styles.avatarImage, className)
    if (image) {
      return <img {...otherProps} className={classes} src={image} />
    }

    const iconStyle = {
      color: randomColorForString(user),
    }

    return <i {...otherProps} className={classes} style={iconStyle}><PlaceholderIcon /></i>
  }
}
