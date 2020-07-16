import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { randomColorForString } from './colors'

import PlaceholderIcon from './avatar-placeholder.svg'

import { amberA400 } from '../styles/colors'

export const ImageAvatar = styled.img`
  width: 40px;
  height: 40px;
  display: inline-block;
  border-radius: 50%;
  ${props => (props.glowing ? `box-shadow: 0 0 8px ${amberA400}` : '')};
`

const IconContainer = styled.div`
  position: relative;
  width: 40px;
  height: 40px;
`

export const IconAvatar = styled(PlaceholderIcon).withConfig({
  // Don't forward the `glowing` property to the `svg` element
  shouldForwardProp: prop => prop !== 'glowing',
})`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  fill: ${props => props.color};
  ${props => (props.glowing ? 'filter: blur(4px)' : '')};
`

export default class Avatar extends React.Component {
  static propTypes = {
    user: PropTypes.string,
    image: PropTypes.string,
    color: PropTypes.string,
    glowing: PropTypes.bool,
  }

  render() {
    const { image, user, color, glowing, ...otherProps } = this.props

    if (image) {
      return <ImageAvatar {...otherProps} src={image} glowing={glowing} />
    }

    let avatarColor
    if (color) {
      avatarColor = color
    } else if (user) {
      avatarColor = randomColorForString(user)
    } else {
      avatarColor = 'rgba(255, 255, 255, 0.5)'
    }

    return (
      <IconContainer className={this.props.className}>
        {glowing ? <IconAvatar color={avatarColor} glowing={true} /> : null}
        <IconAvatar color={avatarColor} />
      </IconContainer>
    )
  }
}
