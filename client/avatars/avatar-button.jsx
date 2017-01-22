import React from 'react'
import classnames from 'classnames'
import Button from '../material/button.jsx'
import buttonStyles from '../material/button.css'
import Avatar from './avatar.jsx'
import avatarStyles from './avatar.css'

export default class AvatarButton extends React.Component {
  static propTypes = {
    avatarClassName: React.PropTypes.string,
    buttonRef: React.PropTypes.func,
  };

  render() {
    const classes = classnames(buttonStyles.iconButton, this.props.className)
    const avatarClasses = classnames(avatarStyles.buttonImage, this.props.avatarClassName)
    const { buttonRef, user, image, ...rest } = this.props
    return (
      <Button {...rest} buttonRef={buttonRef} className={classes}
          label={<Avatar user={user} image={image} className={avatarClasses} />} />
    )
  }
}
