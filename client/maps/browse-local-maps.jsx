import path from 'path'
import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { ActivityBackButton } from '../activities/activity-back-button'
import BrowseFiles from '../file-browser/browse-files'
import MapIcon from '../icons/material/ic_terrain_black_24px.svg'
import LoadingIndicator from '../progress/dots'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { uploadLocalMap } from './action-creators'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const ipcRenderer = new TypedIpcRenderer()

@connect(state => ({ localMaps: state.localMaps, settings: state.settings }))
export default class LocalMaps extends React.Component {
  state = {
    documentsPath: undefined,
  }

  static propTypes = {
    onMapSelect: PropTypes.func,
  }

  componentDidMount() {
    ipcRenderer.invoke('pathsGetDocumentsPath').then(documentsPath => {
      this.setState({ documentsPath: path.join(documentsPath, 'Starcraft', 'maps') })
    })
  }

  componentDidUpdate(prevProps) {
    const { localMaps: prevMaps } = prevProps
    const { localMaps: curMaps } = this.props

    if (!prevMaps.lastError && curMaps.lastError) {
      this.props.dispatch(
        openSnackbar({ message: 'There was a problem uploading the map', time: TIMING_LONG }),
      )
    }
  }

  render() {
    if (!this.props.settings.local.starcraftPath || !this.state.documentsPath) {
      return null
    }

    if (this.props.localMaps.isUploading) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    const fileTypes = {
      scm: { icon: <MapIcon />, onSelect: this.onMapSelect },
      scx: { icon: <MapIcon />, onSelect: this.onMapSelect },
    }
    const defaultFolder = {
      id: 'default',
      name: 'Program folder',
      path: path.join(this.props.settings.local.starcraftPath, 'Maps'),
    }
    const downloadsFolder = {
      id: 'documents',
      name: 'Documents folder',
      path: this.state.documentsPath,
    }
    const props = {
      browseId: 'maps',
      title: 'Local Maps',
      titleButton: <ActivityBackButton />,
      rootFolders: {
        [defaultFolder.id]: defaultFolder,
        [downloadsFolder.id]: downloadsFolder,
      },
      fileTypes,
    }

    return <BrowseFiles {...props} />
  }

  onMapSelect = map => {
    this.props.dispatch(uploadLocalMap(map.path, this.props.onMapSelect))
  }
}
