import React from 'react'
import { connect } from 'react-redux'
import classnames from 'classnames'
import { changePath, getReplays, startReplay } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import styles from './watch-replay.css'

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
    folder: React.PropTypes.object.isRequired,
    onClick: React.PropTypes.func.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return nextProps.folder !== this.props.folder || nextProps.onClick !== this.props.onClick
  }

  render() {
    const { folder, onClick } = this.props
    const classes = classnames(styles.entry, styles.folder)

    return (<div className={classes} onClick={() => onClick(folder)}>
      <div className={styles.info}>
        <span className={styles.name}>{folder.name}</span>
      </div>
    </div>)
  }
}

class ReplayEntry extends React.Component {
  static propTypes = {
    replay: React.PropTypes.object.isRequired,
    onStartReplay: React.PropTypes.func.isRequired,
  };

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.replay !== this.props.replay ||
        nextProps.onStartReplay !== this.props.onStartReplay
  }

  render() {
    const { replay, onStartReplay } = this.props
    const classes = classnames(styles.entry, styles.replay)

    return (<div className={classes} onClick={() => onStartReplay(replay)}>
      <div className={styles.info}>
        <span className={styles.name}>{replay.name}</span>
        <span className={styles.date}>{getLocalDate(new Date(replay.date))}</span>
      </div>
    </div>)
  }
}

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
      return <p>lastError.message</p>
    }

    const isRootFolder = path === ''
    if (isRootFolder && folders.size === 0 && replays.size === 0) {
      return <p>No replays found. Play some games?</p>
    }

    return (<div>
      {
        !isRootFolder ?
            <div className={styles.entry} onClick={this.onGoBackClick}>
              <div className={styles.name}>{'<Go back>'}</div>
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
    const isRootFolder = path === ''
    return (<ScrollableContent
        className={styles.replaysScrollable}
        viewClassName={styles.replaysScrollableView}>
      <p className={styles.path}>{'Replays' + (!isRootFolder ? '\\' : '') + path}</p>
      { this.renderReplays() }
    </ScrollableContent>)
  }

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
