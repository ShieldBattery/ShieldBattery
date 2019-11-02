import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import path from 'path'
import styled from 'styled-components'

import BrowseFiles from '../file-browser/browse-files.jsx'
import IconButton from '../material/icon-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import { closeOverlay } from '../activities/action-creators'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { selectLocalMap } from './action-creators'
import { goBack } from '../activities/action-creators'

import ArrowBack from '../icons/material/baseline-arrow_back-24px.svg'
import MapIcon from '../icons/material/ic_terrain_black_24px.svg'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const BackButton = styled(IconButton)`
  margin-right: 16px;
`

@connect(state => ({ localMaps: state.localMaps, settings: state.settings }))
export default class LocalMaps extends React.Component {
  static propTypes = {
    onMapSelect: PropTypes.func,
  }

  componentDidUpdate(prevProps) {
    const { localMaps: prevMaps } = prevProps
    const { localMaps: curMaps } = this.props

    if (!prevMaps.lastError && curMaps.lastError) {
      this.props.dispatch(closeOverlay())
      this.props.dispatch(
        openSnackbar({ message: 'There was a problem uploading the map', time: TIMING_LONG }),
      )
    }
  }

  render() {
    if (!this.props.settings.local.starcraftPath || this.props.localMaps.lastError) {
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
    const root = path.join(this.props.settings.local.starcraftPath, 'Maps')
    const props = {
      browseId: 'maps',
      title: 'Local Maps',
      titleButton: (
        <BackButton icon={<ArrowBack />} title='Click to go back' onClick={this.onBackClick} />
      ),
      rootFolderName: 'Maps',
      root,
      fileTypes,
    }

    return <BrowseFiles {...props} />
  }

  onMapSelect = map => {
    this.props.dispatch(selectLocalMap(map.path, this.props.onMapSelect))
  }

  onBackClick = () => {
    this.props.dispatch(goBack())
  }
}
