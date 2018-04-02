import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import IconButton from '../material/icon-button.jsx'
import Avatar from './avatar.jsx'

const ButtonAvatar = styled(Avatar)`
  width: 24px;
  height: 24px;
  display: block;
  margin: auto;
  overflow: hidden;

  & > svg {
    width: 24px;
    height: 24px;
  }

  // This has to be on the bottom so it can override any of the style above.
  ${props => props.style};
`

export default class AvatarButton extends React.Component {
  static propTypes = {
    avatarStyle: PropTypes.array,
    buttonRef: PropTypes.func,
  }

  render() {
    const { buttonRef, user, image, avatarStyle, ...rest } = this.props

    return (
      <IconButton
        {...rest}
        buttonRef={buttonRef}
        icon={<ButtonAvatar user={user} image={image} style={avatarStyle} />}
      />
    )
  }
}
