import React from 'react'
import PropTypes from 'prop-types'

import MapImage from './map-image.jsx'

export default class MapPreview extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
  }

  render() {
    const { map } = this.props

    return <MapImage map={map} size={1024} showNotAvailableText={true} />
  }
}
