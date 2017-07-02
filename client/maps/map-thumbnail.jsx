import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './maps.css'

export default class MapThumbnail extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    showMapName: PropTypes.bool,
    hoverIcon: PropTypes.element,
    mapClassName: PropTypes.string,
    thumbnailClassName: PropTypes.string,
    onMapClick: PropTypes.func,
  }

  render() {
    const { map, showMapName, hoverIcon, mapClassName, thumbnailClassName, onMapClick } = this.props

    const mapProps = {
      onClick: onMapClick,
    }

    const mapClasses = classnames(styles.map, mapClassName)
    const thumbnailClasses = classnames(styles.thumbnail, thumbnailClassName)
    return (
      <div className={mapClasses} {...mapProps}>
        <img className={thumbnailClasses} src={map.imageUrl} />
        {showMapName
          ? <span className={styles.name}>
              {map.name}
            </span>
          : null}
        {hoverIcon
          ? <div className={styles.overlayContainer}>
              <div key="overlay" className={styles.overlay} />
              <span key="icon" className={styles.hoverIcon}>
                {hoverIcon}
              </span>
            </div>
          : null}
      </div>
    )
  }
}
