import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { randomColorForString } from './colors'

import PlaceholderIcon from './avatar-placeholder.svg'

export const ImageAvatar = styled.img`
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
      <ImageAvatar as='i' {...otherProps} style={iconStyle}>
        <PlaceholderIcon />
      </ImageAvatar>
    )
  }
}
