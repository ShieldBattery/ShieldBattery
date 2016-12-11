import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import classnames from 'classnames'
import { changePath, getReplays, startReplay } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import styles from './watch-replay.css'

import ChevronRight from '../icons/material/ic_chevron_right_black_24px.svg'
import Folder from '../icons/material/ic_folder_black_24px.svg'
import Replay from '../icons/material/ic_movie_black_24px.svg'
import UpDirectory from '../icons/material/ic_subdirectory_arrow_left_black_24px.svg'
import LoadingIndicator from '../progress/dots.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

const monthShortNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const localeDateSupported = !!Date.prototype.toLocaleDateString
function getLocalDate(date) {
  if (localeDateSupported) {
    return date.toLocaleDateString(navigator.language, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const year = date.getFullYear()
  const month = monthShortNames[date.getMonth()]
  const day = date.getDate()
  let hour = date.getHours()
  const isPm = hour >= 12
  hour = isPm ? (hour - 12) : hour
  if (hour === 0) {
    hour = 12
  }
  let minute = '' + date.getMinutes()
  if (minute.length === 1) {
    minute = '0' + minute
  }
  return `${month} ${day < 10 ? '0' + day : day}, ${year}, ${hour}:${minute} ${isPm ? 'PM' : 'AM'}`
}

class FolderEntry extends React.Component {
  static propTypes = {
    folder: PropTypes.object.isRequired,
    onClick: PropTypes.func.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return nextProps.folder !== this.props.folder || nextProps.onClick !== this.props.onClick
  }

  render() {
    const { folder, onClick } = this.props
    const classes = classnames(styles.entry, styles.folder)

    return (<div className={classes} onClick={() => onClick(folder)}>
      <div className={styles.entryIcon}><Folder/></div>
      <div className={styles.info}>
        <span className={styles.name}>{folder.name}</span>
      </div>
    </div>)
  }
}

class ReplayEntry extends React.Component {
  static propTypes = {
    replay: PropTypes.object.isRequired,
    onStartReplay: PropTypes.func.isRequired,
  };

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.replay !== this.props.replay ||
        nextProps.onStartReplay !== this.props.onStartReplay
  }

  render() {
    const { replay, onStartReplay } = this.props
    const classes = classnames(styles.entry, styles.replay)

    return (<div className={classes} onClick={() => onStartReplay(replay)}>
      <div className={styles.entryIcon}><Replay/></div>
      <div className={styles.info}>
        <span className={styles.name}>{replay.name}</span>
        <span className={styles.date}>{getLocalDate(new Date(replay.date))}</span>
      </div>
    </div>)
  }
}

class PathBreadcrumbs extends React.Component {
  static propTypes = {
    path: PropTypes.string.isRequired,
    onNavigate: PropTypes.func.isRequired,
    className: PropTypes.string,
  };

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.path !== this.props.path
  }

  render() {
    const pieces = this.props.path.split('\\')
    if (pieces[pieces.length - 1] === '') {
      // Remove the last entry if it's empty (due to a trailing slash)
      pieces.pop()
    }
    const { elems } = pieces.reduce((r, piece, i) => {
      const isLast = i === pieces.length - 1
      r.curPath += (i === 0 ? '' : '\\') + piece
      // Save the value at the current time so the function doesn't always use the last value
      const navPath = r.curPath
      r.elems.push(<span
          className={isLast ? styles.breadcrumbActive : styles.breadcrumb}
          onClick={isLast ? undefined : () => this.props.onNavigate(navPath)}>{piece}</span>)
      if (!isLast) {
        r.elems.push(<ChevronRight className={styles.breadcrumbSeparator} />)
      }

      return r
    }, { elems: [], curPath: '' })

    return <div className={this.props.className}>{elems}</div>
  }
}

const ROOT_FOLDER_NAME = 'replays'

@connect(state => ({ replays: state.replays }))
export default class Replays extends React.Component {
  componentDidMount() {
    this.props.dispatch(getReplays(this.props.replays.path))
  }

  componentDidUpdate(prevProps) {
    const { path } = this.props.replays
    if (prevProps.replays.path !== path) {
      this.props.dispatch(getReplays(path))
    }
  }

  renderReplays() {
    const { folders, replays, path, isRequesting, lastError } = this.props.replays
    if (isRequesting) {
      return <LoadingIndicator />
    }

    if (lastError) {
      return <p>{lastError.message}</p>
    }

    const isRootFolder = path === ''
    if (isRootFolder && folders.size === 0 && replays.size === 0) {
      return <p>No replays found. Play some games?</p>
    }

    return (<div className={styles.replayList}>
      {
        !isRootFolder ?
            <div className={styles.entry} onClick={this.onGoBackClick} key={'up-one-dir'}>
              <div className={styles.entryIcon}><UpDirectory/></div>
              <div className={styles.name}>{'Up one directory'}</div>
            </div> :
            null
      }
      { folders.map(folder =>
          <FolderEntry folder={folder} onClick={this.onFolderClick} key={folder.path} />) }
      { replays.map(replay =>
          <ReplayEntry replay={replay} onStartReplay={this.onStartReplay} key={replay.path} />) }
    </div>)
  }

  render() {
    const { path } = this.props.replays
    const displayedPath = `${ROOT_FOLDER_NAME}\\${path}`
    return (<div className={styles.root}>
      <h3 className={styles.contentTitle}>Local replays</h3>
      <PathBreadcrumbs className={styles.path}
          path={displayedPath} onNavigate={this.onBreadcrumbNavigate} />
      <ScrollableContent
          className={styles.replaysScrollable}
          viewClassName={styles.replaysScrollableView}>
        { this.renderReplays() }
      </ScrollableContent>
    </div>)
  }

  onBreadcrumbNavigate = path => {
    const pathWithoutRoot = path.slice(ROOT_FOLDER_NAME.length + 1)
    this.props.dispatch(changePath(pathWithoutRoot))
  };

  onGoBackClick = () => {
    const { path } = this.props.replays
    const prevPath = path.lastIndexOf('\\') !== -1 ? path.slice(0, path.lastIndexOf('\\')) : ''
    this.props.dispatch(changePath(prevPath))
  };

  onFolderClick = folder => {
    this.props.dispatch(changePath(folder.path))
  };

  onStartReplay = replay => {
    this.props.dispatch(closeOverlay())
    this.props.dispatch(startReplay(replay))
  };
}
