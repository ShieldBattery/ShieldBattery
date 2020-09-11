import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import ImageIcon from '../icons/material/baseline-image-24px.svg'

import { grey800 } from '../styles/colors'
import { Subheading } from '../styles/typography'

const ImgElement = styled.img`
  display: block;
  width: 100%;
  object-fit: cover;
`

const NoImage = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 220px;
  background-color: ${grey800};

  & > svg {
    width: 90px;
    height: 90px;
    opacity: 0.5;
  }
`

export default class MapImage extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    size: PropTypes.number,
    showNotAvailableText: PropTypes.bool,
  }

  static defaultProps = {
    size: 256,
  }

  render() {
    const { map, size, showNotAvailableText } = this.props
    const srcSet = `
      ${map.image256Url} 256w,
      ${map.image512Url} 512w,
      ${map.image1024Url} 1024w,
      ${map.image2048Url} 2048w
    `

    // TODO(2Pac): Actually check if the image URL is available instead of just checking it's set.
    return (
      <>
        {map.image256Url ? (
          <ImgElement
            className={this.props.className}
            srcSet={srcSet}
            sizes={`${size}px`}
            src={map.image256Url}
            alt={map.name}
            draggable={false}
          />
        ) : (
          <NoImage>
            <ImageIcon />
            {showNotAvailableText ? <Subheading>Map preview not available</Subheading> : null}
          </NoImage>
        )}
      </>
    )
  }
}
