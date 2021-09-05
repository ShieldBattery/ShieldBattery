import path from 'path'
import React from 'react'
import { connect } from 'react-redux'
import { TypedIpcRenderer } from '../../common/ipc'
import { closeOverlay } from '../activities/action-creators'
import BrowseFiles from '../file-browser/browse-files'
import Replay from '../icons/material/ic_movie_black_24px.svg'
import { startReplay } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

async function getReplayFolder() {
  return path.join(
    await ipcRenderer.invoke('pathsGetDocumentsPath'),
    'Starcraft',
    'maps',
    'replays',
  )
}

@connect()
export default class Replays extends React.Component {
  state = {
    replayFolder: undefined,
  }

  componentDidMount() {
    getReplayFolder().then(replayFolder => {
      this.setState({ replayFolder })
    })
  }

  render() {
    if (!this.state.replayFolder) {
      return null
    }

    const fileTypes = {
      rep: { icon: <Replay />, onSelect: this.onStartReplay },
    }
    const defaultFolder = {
      id: 'default',
      name: 'Replays',
      path: this.state.replayFolder,
    }
    const props = {
      browseId: 'replays',
      title: 'Local Replays',
      rootFolders: {
        [defaultFolder.id]: defaultFolder,
      },
      fileTypes,
    }
    return <BrowseFiles {...props} />
  }

  onStartReplay = replay => {
    this.props.dispatch(closeOverlay())
    this.props.dispatch(startReplay(replay))
  }
}
