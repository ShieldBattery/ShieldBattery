import React from 'react'
import { connect } from 'react-redux'
import path from 'path'
import { remote } from 'electron'

import BrowseFiles from './browse-files.jsx'
import { startReplay } from './action-creators'
import { closeOverlay } from '../activities/action-creators'

import Replay from '../icons/material/ic_movie_black_24px.svg'

function getReplayFolder() {
  return path.join(remote.app.getPath('documents'), 'Starcraft', 'maps', 'replays')
}

@connect()
export default class Replays extends React.Component {
  render() {
    const fileTypes = {
      rep: { icon: <Replay />, onSelect: this.onStartReplay },
    }
    const props = {
      browseId: 'replays',
      title: 'Local Replays',
      rootFolderName: 'replays',
      root: getReplayFolder(),
      fileTypes,
    }
    return <BrowseFiles {...props} />
  }

  onStartReplay = replay => {
    this.props.dispatch(closeOverlay())
    this.props.dispatch(startReplay(replay))
  }
}
