import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import styles from './maps.css'

export default class MapThumbnail extends React.Component {
  static propTypes = {
    map: PropTypes.object.isRequired,
    shouldDisplayMapName: PropTypes.bool,
    hoverIcon: PropTypes.element,
    mapClassName: PropTypes.string,
    mapImageClassName: PropTypes.string,
    onMapClick: PropTypes.func,
  }

  state = {
    isHovered: false,
  }

  render() {
    const {
      map,
      shouldDisplayMapName,
      hoverIcon,
      mapClassName,
      mapImageClassName,
      onMapClick,
    } = this.props

    let mapProps = {}
    if (hoverIcon) {
      mapProps = {
        ...mapProps,
        onMouseOver: this.onLeftMouseOver,
        onMouseLeave: this.onLeftMouseLeave,
      }
    }
    if (onMapClick) {
      mapProps = {
        ...mapProps,
        onClick: onMapClick,
      }
    }

    const mapClasses = classnames(styles.map, mapClassName)
    const mapImageClasses = classnames(styles.mapImage, mapImageClassName)
    return (<div className={mapClasses} {...mapProps}>
      <img className={mapImageClasses} src={map.imageUrl} />
      { shouldDisplayMapName ? <span className={styles.mapName}>{map.name}</span> : null }
      { hoverIcon && this.state.isHovered ? ([
        // Waiting patiently for React version where adjecent elements don't have to be wrapped!
        <div key='wtf' className={styles.mapOverlay}></div>,
        <span key='ftw' className={styles.hoverIcon}>{hoverIcon}</span>
      ]) : null
      }
    </div>)
  }

  onLeftMouseOver = () => {
    this.setState({ isHovered: true })
  }

  onLeftMouseLeave = () => {
    this.setState({ isHovered: false })
  }
}
