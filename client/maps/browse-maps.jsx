import React from 'react'
import { connect } from 'react-redux'
import path from 'path'

import { selectLocalMap } from './action-creators'
import BrowseFiles from '../file-browser/browse-files.jsx'

import MapIcon from '../icons/material/ic_terrain_black_24px.svg'

@connect(state => ({ maps: state.maps, settings: state.settings }))
export default class Maps extends React.Component {
  render() {
    if (!this.props.settings.local.starcraftPath) {
      return null
    }
    const fileTypes = {
      scm: { icon: <MapIcon />, onSelect: this.onSelectMap },
      scx: { icon: <MapIcon />, onSelect: this.onSelectMap },
    }
    const root = path.join(this.props.settings.local.starcraftPath, 'Maps')
    const props = {
      browseId: 'maps',
      title: 'Local Maps',
      rootFolderName: 'Maps',
      root,
      fileTypes,
      error: this.props.maps.localMapError,
    }

    return <BrowseFiles {...props} />
  }

  onSelectMap = map => {
    this.props.dispatch(selectLocalMap(map.path))
  }
}
