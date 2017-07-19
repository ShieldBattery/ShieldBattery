import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './maps.css'

import MapThumbnail from './map-thumbnail.jsx'

export default class MapList extends React.Component {
  static propTypes = {
    maps: PropTypes.array.isRequired,
    className: PropTypes.string,
    mapClassName: PropTypes.string,
    thumbnailClassName: PropTypes.string,
    hoverIcon: PropTypes.element,
    showMapName: PropTypes.bool,
    onMapClick: PropTypes.func,
  }

  render() {
    const {
      maps,
      className,
      mapClassName,
      thumbnailClassName,
      hoverIcon,
      showMapName,
      onMapClick,
    } = this.props

    const mapList = maps.map(map =>
      <MapThumbnail
        key={map.hash}
        map={map}
        hoverIcon={hoverIcon}
        showMapName={showMapName}
        mapClassName={mapClassName}
        thumbnailClassName={thumbnailClassName}
        onMapClick={() => onMapClick(map)}
      />,
    )

    const mapListClasses = classnames(styles.mapList, className)
    return (
      <div className={mapListClasses}>
        {mapList}
      </div>
    )
  }
}
