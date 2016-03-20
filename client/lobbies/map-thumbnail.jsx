import React from 'react'

const BASE_URL = '/thumbs/'

export default class MapThumbnail extends React.Component {
  static propTypes = {
    className: React.PropTypes.string,
    map: React.PropTypes.object.isRequired,
  };

  render() {
    const { className, map } = this.props

    const firstByte = map.hash.substr(0, 2)
    const secondByte = map.hash.substr(2, 2)
    const url = `${BASE_URL}${firstByte}/${secondByte}/${map.hash}.${map.thumbFormat}`

    return <img className={className} src={url} />
  }
}
