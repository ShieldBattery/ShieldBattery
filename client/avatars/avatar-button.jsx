import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import IconButton from '../material/icon-button'
import Avatar from './avatar'

const StyledAvatar = styled(Avatar)`
  width: 24px;
  height: 24px;
  display: block;
  margin: auto;
  overflow: hidden;

  // This has to be on the bottom so it can override any of the style above.
  ${props => props.style};
`

const AvatarButton = React.forwardRef((props, ref) => {
  const { buttonRef, user, image, avatarStyle, ...rest } = props

  return (
    <IconButton
      ref={ref}
      {...rest}
      buttonRef={buttonRef}
      icon={<StyledAvatar user={user} image={image} style={avatarStyle} />}
    />
  )
})

AvatarButton.propTypes = {
  avatarStyle: PropTypes.array,
  buttonRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
}

export default AvatarButton
