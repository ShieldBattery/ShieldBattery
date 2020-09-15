import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import MapImage from './map-image.jsx'

const StyledMapImage = styled(MapImage)`
  width: 100%;
`

export default class MapPreview extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
  }

  render() {
    const { map } = this.props

    return <StyledMapImage map={map} size={1024} />
  }
}
