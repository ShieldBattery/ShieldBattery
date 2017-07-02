import React from 'react'
import PropTypes from 'prop-types'

export default class MapThumbnail extends React.Component {
  static propTypes = {
    className: PropTypes.string,
    map: PropTypes.object.isRequired,
  }

  render() {
    const { className, map } = this.props

    return <img className={className} src={map.imageUrl} />
  }
}
