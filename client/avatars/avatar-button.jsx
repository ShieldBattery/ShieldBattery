import React from 'react'
import classnames from 'classnames'
import Button from '../material/button.jsx'
import buttonStyles from '../material/button.css'
import Avatar from './avatar.jsx'
import avatarStyles from './avatar.css'

export default class AvatarButton extends React.Component {
  render() {
    const classes = classnames(buttonStyles.iconButton, this.props.className)
    const { user, image, ...rest } = this.props
    return (
      <Button {...rest} className={classes}
          label={<Avatar user={user} image={image} className={avatarStyles.buttonImage} />} />
    )
  }
}
