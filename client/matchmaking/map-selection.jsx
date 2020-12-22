import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { rgba } from 'polished'

import MapThumbnail from '../maps/map-thumbnail.jsx'

import RandomIcon from '../icons/material/ic_casino_black_24px.svg'

import { shadowDef2dp } from '../material/shadow-constants'
import { blue200, grey800 } from '../styles/colors'
import { Display3Old, SubheadingOld } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
`

const MapsContainer = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto auto;
  grid-gap: 32px;
  margin-top: 40px;
`

const MapContainer = styled.div`
  width: 256px;
  height: 256px;
  border-radius: 2px;
  box-shadow: ${shadowDef2dp};

  ${props => {
    if (props.glowing) {
      return `
        box-shadow: 0px 0px 32px 8px ${rgba(blue200, 0.5)};
      `
    }

    return ''
  }}
`

const RandomThumbnail = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: ${grey800};
`

const StyledRandomIcon = styled(RandomIcon)`
  width: 128px;
  height: 128px;
  opacity: 0.5;
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
        <MapContainer key={m.id} glowing={m.id === chosenMap.id}>
          <MapThumbnail map={m} showMapName={true} />
        </MapContainer>
      )
    })
    const randomMapsItems = randomMaps.map(m => {
      return (
        <MapContainer key={m.id} glowing={m.id === chosenMap.id}>
          <RandomThumbnail>
            <StyledRandomIcon />
            <SubheadingOld>Random map</SubheadingOld>
          </RandomThumbnail>
        </MapContainer>
      )
    })

    return (
      <Container>
        <Display3Old>Map pool</Display3Old>
        <MapsContainer>
          {preferredMapsItems}
          {randomMapsItems}
        </MapsContainer>
      </Container>
    )
  }
}
