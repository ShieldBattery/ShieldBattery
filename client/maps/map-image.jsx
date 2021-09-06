import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import ImageIcon from '../icons/material/baseline-image-24px.svg'
import { background700 } from '../styles/colors'
import { Subtitle1 } from '../styles/typography'

const ImgContainer = styled.div`
  position: relative;
  height: 0;
  overflow: hidden;
  padding-bottom: ${props => `${props.aspectRatio * 100}%`};
`

const ImgElement = styled.img`
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const NoImageContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 220px;
  background-color: ${background700};

  & > svg {
    width: 90px;
    height: 90px;
    opacity: 0.5;
  }
`

const NoImage = () => (
  <NoImageContainer>
    <ImageIcon />
    <Subtitle1>Map preview not available</Subtitle1>
  </NoImageContainer>
)

export default class MapImage extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    size: PropTypes.number,
    altText: PropTypes.string,
    noImageElem: PropTypes.element,
  }

  static defaultProps = {
    size: 256,
    noImageElem: <NoImage />,
  }

  render() {
    const { map, size, altText, noImageElem } = this.props
    const srcSet = `
      ${map.image256Url} 256w,
      ${map.image512Url} 512w,
      ${map.image1024Url} 1024w,
      ${map.image2048Url} 2048w
    `

    const aspectRatio = map.mapData.height / map.mapData.width
    const width = size
    const height = size * aspectRatio

    // TODO(2Pac): handle 404s
    return (
      <>
        {map.image256Url ? (
          <ImgContainer className={this.props.className} aspectRatio={aspectRatio}>
            <ImgElement
              width={width}
              height={height}
              srcSet={srcSet}
              sizes={`${size}px`}
              src={map.image256Url}
              alt={altText || map.name}
              draggable={false}
              decoding={'async'}
            />
          </ImgContainer>
        ) : (
          noImageElem
        )}
      </>
    )
  }
}
