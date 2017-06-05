import React from 'react'

export default class MapThumbnail extends React.Component {
  static propTypes = {
    className: React.PropTypes.string,
    map: React.PropTypes.object.isRequired,
  };

  render() {
    const { className, map } = this.props

    return <img className={className} src={map.imageUrl} />
  }
}
