import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import classnames from 'classnames'
import { getReplays, startReplay } from './action-creators'
import { closeOverlay } from '../activities/action-creators'
import styles from './watch-replays.css'

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
    return nextProps.folder !== this.props.folder
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
    return nextProps.replay !== this.props.replay
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

@connect(state => ({ replays: state.replays, hasActiveGame: state.activeGame.isActive }))
export default class Replays extends React.Component {
  state = {
    path: ''
  };

  componentDidMount() {
    this.props.dispatch(getReplays(this.state.path))
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.hasActiveGame) {
      this.props.dispatch(routerActions.push('/active-game'))
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.path !== this.state.path) {
      this.props.dispatch(getReplays(this.state.path))
    }
  }

  renderReplays() {
    const { folders, replays } = this.props.replays
    if (this.props.replays.isRequesting) {
      return <LoadingIndicator />
    }

    return (<div>
      { folders.map(folder =>
          <FolderEntry folder={folder} onClick={this.onFolderClick} key={folder.path} />) }
      { replays.map(replay =>
          <ReplayEntry replay={replay} onStartReplay={this.onStartReplay} key={replay.path} />) }
    </div>)
  }

  render() {
    const isRootFolder = this.state.path === ''
    return (<ScrollableContent
        className={styles.replaysScrollable}
        viewClassName={styles.replaysScrollableView}>
      <p className={styles.path}>{'Replays' + (!isRootFolder ? '\\' : '') + this.state.path}</p>
      { this.renderReplays() }
    </ScrollableContent>)
  }

  onFolderClick = folder => {
    this.setState({ path: folder.path })
  };

  onStartReplay = replay => {
    this.props.dispatch(closeOverlay())
    this.props.dispatch(startReplay(replay))
  };
}
