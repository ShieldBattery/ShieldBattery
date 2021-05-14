import { remote } from 'electron'
import path from 'path'
import React from 'react'
import { connect } from 'react-redux'
import { closeOverlay } from '../activities/action-creators'
import BrowseFiles from '../file-browser/browse-files'
import Replay from '../icons/material/ic_movie_black_24px.svg'
import { startReplay } from './action-creators'

function getReplayFolder() {
  return path.join(remote.app.getPath('documents'), 'Starcraft', 'maps', 'replays')
}

@connect()
export default class Replays extends React.Component {
  render() {
    const fileTypes = {
      rep: { icon: <Replay />, onSelect: this.onStartReplay },
    }
    const defaultFolder = {
      id: 'default',
      name: 'Replays',
      path: getReplayFolder(),
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
