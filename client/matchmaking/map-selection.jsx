import React from 'react'
import PropTypes from 'prop-types'
import styled, { css, keyframes } from 'styled-components'
import { rgba } from 'polished'

import MapThumbnail from '../maps/map-thumbnail.jsx'

import RandomIcon from '../icons/material/ic_casino_black_24px.svg'

import { fastOutLinearIn } from '../material/curve-constants'
import { shadowDef2dp } from '../material/shadow-constants'
import { amberA400, grey800 } from '../styles/colors'
import { Headline2, Subtitle2 } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;

  padding-top: 40px;
`

const MapsContainer = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto auto;
  grid-gap: 32px;
  margin-top: 80px;
`

const pulse = keyframes`
  0%, 20%, 80%, 100% {
    opacity: 1;
  }

  50% {
    opacity: 0;
  }
`

const MapContainer = styled.div`
  position: relative;
  width: 256px;
  height: 256px;
  background-color: ${grey800};
  border-radius: 2px;
  box-shadow: ${shadowDef2dp};

  &::after {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    content: '';

    border-radius: 2px;
    border: 2px solid ${props => rgba(amberA400, props.selected ? 0.7 : 0)};
    box-shadow: ${props =>
      props.selected
        ? `inset 0px 0px 16px -10px ${rgba(amberA400, 0.7)},
           inset 0px 0px 14px 0px ${rgba(amberA400, 0.24)};`
        : 'none'};

    animation: ${pulse} 3s ${fastOutLinearIn} infinite;
    transition: opacity;
  }
`

const RandomThumbnail = styled.div`
  position: absolute;
  left: 0;
  top: 44px;
  width: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
`

const StyledRandomIcon = styled(RandomIcon)`
  width: 128px;
  height: 128px;
  opacity: 0.5;
  margin-bottom: 24px;
`

export default class MapSelection extends React.Component {
  static propTypes = {
    preferredMaps: PropTypes.array.isRequired,
    randomMaps: PropTypes.array.isRequired,
    chosenMap: PropTypes.object.isRequired,
  }

  render() {
    const { preferredMaps, randomMaps, chosenMap } = this.props
    const preferredMapsItems = preferredMaps.map(m => {
      return (
        <MapContainer key={m.id} selected={m.id === chosenMap.id}>
          <MapThumbnail map={m} showMapName={true} />
        </MapContainer>
      )
    })
    const randomMapsItems = randomMaps.map(m => {
      return (
        <MapContainer key={m.id} selected={m.id === chosenMap.id}>
          <RandomThumbnail>
            <StyledRandomIcon />
            <Subtitle2>Random map</Subtitle2>
          </RandomThumbnail>
        </MapContainer>
      )
    })

    return (
      <Container>
        <Headline2>Map pool</Headline2>
        <MapsContainer>
          {preferredMapsItems}
          {randomMapsItems}
        </MapsContainer>
      </Container>
    )
  }
}
