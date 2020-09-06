import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import ImageIcon from '../icons/material/baseline-image-24px.svg'

import { Subheading } from '../styles/typography'

const Container = styled.div`
  width: 100%;
`

const MapImage = styled.img`
  width: 100%;
`

const NoImage = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;

  & > svg {
    width: 90px;
    height: 90px;
    opacity: 0.5;
  }
`

export default class MapPreview extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
  }

  render() {
    const { map } = this.props

    return (
      <Container className={this.props.className}>
        {map.imageUrl ? (
          <picture>
            <source srcSet={`${map.imageUrl} 1x`} />
            <source srcSet={`${map.imagex2Url} 2x`} />
            <MapImage src={map.imageUrl} alt={map.name} draggable={false} />
          </picture>
        ) : (
          <NoImage>
            <ImageIcon />
            <Subheading>Map preview not available</Subheading>
          </NoImage>
        )}
      </Container>
    )
  }
}
