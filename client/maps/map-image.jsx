import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { background700, colorTextFaint } from '../styles/colors'
import { Subtitle1 } from '../styles/typography'

const ImgContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`

const ImgElement = styled.img`
  display: block;
  aspect-ratio: var(--sb-map-image-aspect-ratio, 1);
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
  color: ${colorTextFaint};
`

const NoImageIcon = styled(MaterialIcon).attrs({ icon: 'image', size: 90 })`
  opacity: 0.5;
`

export const MapNoImage = () => (
  <NoImageContainer>
    <NoImageIcon />
    <Subtitle1>Map preview not available</Subtitle1>
  </NoImageContainer>
)

export default class MapImage extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    size: PropTypes.number,
    altText: PropTypes.string,
    noImageElem: PropTypes.element,
    forceAspectRatio: PropTypes.number,
  }

  static defaultProps = {
    size: 256,
    noImageElem: <MapNoImage />,
  }

  render() {
    const { map, size, altText, noImageElem, forceAspectRatio } = this.props
    const srcSet = `
      ${map.image256Url} 256w,
      ${map.image512Url} 512w,
      ${map.image1024Url} 1024w,
      ${map.image2048Url} 2048w
    `

    const aspectRatio = map.mapData.width / map.mapData.height
    const width = size
    const height = size / aspectRatio

    const style = {
      '--sb-map-image-aspect-ratio':
        forceAspectRatio !== undefined ? forceAspectRatio : aspectRatio,
    }

    // TODO(2Pac): handle 404s
    return (
      <>
        {map.image256Url ? (
          <ImgContainer className={this.props.className} style={style}>
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
