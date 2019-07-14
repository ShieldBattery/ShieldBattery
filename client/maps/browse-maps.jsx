import React from 'react'
import { connect } from 'react-redux'
import path from 'path'
import styled from 'styled-components'

import { uploadMap } from './action-creators'
import BrowseFiles from '../file-browser/browse-files.jsx'
import LoadingIndicator from '../progress/dots.jsx'

import MapIcon from '../icons/material/ic_terrain_black_24px.svg'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

@connect(state => ({ maps: state.maps, settings: state.settings }))
export default class Maps extends React.Component {
  render() {
    if (!this.props.settings.local.starcraftPath) {
      return null
    }

    if (this.props.maps.isUploading) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
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
    }

    return <BrowseFiles {...props} />
  }

  onSelectMap = map => {
    this.props.dispatch(uploadMap(map.path))
  }
}
