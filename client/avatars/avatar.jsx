import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { randomColorForString } from './colors'

import PlaceholderIcon from './avatar-placeholder.svg'

const ImageAvatar = styled.img`
  width: 40px;
  height: 40px;
  display: inline-block;

  & > svg {
    width: 100%;
    height: 100%;
  }

  img.& {
    border-radius: 50%;
  }
`

export const IconAvatar = ImageAvatar.withComponent('i')

export default class Avatar extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    image: PropTypes.string,
  }

  render() {
    const { image, user, ...otherProps } = this.props

    if (image) {
      return <ImageAvatar {...otherProps} src={image} />
    }

    const iconStyle = {
      color: randomColorForString(user),
    }

    return (
      <IconAvatar {...otherProps} style={iconStyle}>
        <PlaceholderIcon />
      </IconAvatar>
    )
  }
}
