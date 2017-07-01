import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './maps.css'

import MapThumbnail from './map-thumbnail.jsx'

export default class MapList extends React.Component {
  static propTypes = {
    maps: PropTypes.array.isRequired,
    className: PropTypes.string,
    thumbnailClassName: PropTypes.string,
    hoverIcon: PropTypes.element,
    shouldDisplayMapName: PropTypes.bool,
    onMapClick: PropTypes.func,
  }

  render() {
    const {
      maps,
      className,
      thumbnailClassName,
      hoverIcon,
      shouldDisplayMapName,
      onMapClick,
    } = this.props

    const mapList = maps.map(map => (<MapThumbnail key={map.hash} map={map} hoverIcon={hoverIcon}
      shouldDisplayMapName={shouldDisplayMapName} thumbnailClassName={thumbnailClassName}
      onMapClick={() => onMapClick(map)} />))

    const mapListClasses = classnames(styles.mapList, className)
    return (<div className={mapListClasses}>
      { mapList }
    </div>)
  }
}
