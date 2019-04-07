import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import classnames from 'classnames'
import memoize from 'memoize-one'
import keycode from 'keycode'
import pathApi from 'path'
import { List } from 'immutable'
import { List as VirtualizedList } from 'react-virtualized'

import styles from './browse-files.css'
import { changePath, getFiles } from './action-creators'

import ChevronRight from '../icons/material/ic_chevron_right_black_24px.svg'
import Folder from '../icons/material/ic_folder_black_24px.svg'
import Refresh from '../icons/material/ic_refresh_black_24px.svg'
import UpDirectory from '../icons/material/ic_subdirectory_arrow_left_black_24px.svg'

import KeyListener from '../keyboard/key-listener.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import IconButton from '../material/icon-button.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const FOCUSED_KEY = 'FocusedPath'

const ENTER = keycode('enter')
const UP = keycode('up')
const DOWN = keycode('down')
const PAGEUP = keycode('page up')
const PAGEDOWN = keycode('page down')
const HOME = keycode('home')
const END = keycode('end')

const VERT_PADDING = 8
const ENTRY_HEIGHT = 60

class UpOneDir extends React.PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    isFocused: PropTypes.bool,
  }

  render() {
    const { style, isFocused, onClick } = this.props
    const upOneDirClasses = classnames(styles.entry, {
      [styles.focused]: isFocused,
    })

    return (
      <div style={style} className={upOneDirClasses} onClick={onClick} key={'up-one-dir'}>
        <div className={styles.entryIcon}>
          <UpDirectory />
        </div>
        <div className={styles.name}>{'Up one directory'}</div>
      </div>
    )
  }
}

class FolderEntry extends React.PureComponent {
  static propTypes = {
    folder: PropTypes.object.isRequired,
    onClick: PropTypes.func.isRequired,
    isFocused: PropTypes.bool,
  }

  render() {
    const { folder, onClick } = this.props
    const classes = classnames(styles.entry, styles.folder, {
      [styles.focused]: this.props.isFocused,
    })

    return (
      <div style={this.props.style} className={classes} onClick={() => onClick(folder)}>
        <div className={styles.entryIcon}>
          <Folder />
        </div>
        <div className={styles.info}>
          <span className={styles.name}>{folder.name}</span>
        </div>
      </div>
    )
  }
}

class FileEntry extends React.PureComponent {
  static propTypes = {
    file: PropTypes.object.isRequired,
    onClick: PropTypes.func.isRequired,
    isFocused: PropTypes.bool,
  }

  render() {
    const { file, onClick, icon } = this.props
    const classes = classnames(styles.entry, styles.file, {
      [styles.focused]: this.props.isFocused,
    })

    return (
      <div style={this.props.style} className={classes} onClick={() => onClick(file)}>
        <div className={styles.entryIcon}>{icon}</div>
        <div className={styles.info}>
          <span className={styles.name}>{file.name}</span>
          <span className={styles.date}>{dateFormat.format(file.date)}</span>
        </div>
      </div>
    )
  }
}

class PathBreadcrumbs extends React.Component {
  static propTypes = {
    path: PropTypes.string.isRequired,
    onNavigate: PropTypes.func.isRequired,
    className: PropTypes.string,
  }

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.path !== this.props.path
  }

  render() {
    const pieces = this.props.path.split('\\')
    if (pieces[pieces.length - 1] === '') {
      // Remove the last entry if it's empty (due to a trailing slash)
      pieces.pop()
    }
    const { elems } = pieces.reduce(
      (r, piece, i) => {
        const isLast = i === pieces.length - 1
        r.curPath += (i === 0 ? '' : '\\') + piece
        // Save the value at the current time so the function doesn't always use the last value
        const navPath = r.curPath
        r.elems.push(
          <span
            key={i}
            className={isLast ? styles.breadcrumbActive : styles.breadcrumb}
            onClick={isLast ? undefined : () => this.props.onNavigate(navPath)}>
            {piece}
          </span>,
        )
        r.elems.push(<ChevronRight key={i + '|'} className={styles.breadcrumbSeparator} />)

        return r
      },
      { elems: [], curPath: '' },
    )

    return <div className={this.props.className}>{elems}</div>
  }
}

@connect(state => ({ fileBrowser: state.fileBrowser }))
export default class Files extends React.Component {
  state = {
    focusedPath: window.localStorage.getItem(this.props.browseId + FOCUSED_KEY),
  }

  focusTimeout = null
  browserRef = React.createRef()
  contentRef = React.createRef()
  listRef = React.createRef()

  getEntries = memoize(
    props => {
      const { browseId, fileBrowser, root, fileTypes } = props
      const { path, files, folders } = fileBrowser[browseId]
      const isRootFolder = path === root
      const upOneDir = isRootFolder ? new List([]) : new List([{ path: path + '\\..' }])
      const filteredFiles = files.filter(f => fileTypes[f.extension])
      return upOneDir.concat(folders, filteredFiles)
    },
    (newArgs, prevArgs) => {
      const { browseId, fileBrowser } = newArgs[0]
      const { path, folders, files } = fileBrowser[browseId]
      const { browseId: prevBrowseId, fileBrowser: prevFileBrowser } = prevArgs[0]
      const { path: prevPath, folders: prevFolders, files: prevFiles } = prevFileBrowser[
        prevBrowseId
      ]

      return path === prevPath && folders.size === prevFolders.size && files.size === prevFiles.size
    },
  )

  _saveToLocalStorage = () => {
    const { focusedPath } = this.state

    if (focusedPath) {
      window.localStorage.setItem(this.props.browseId + FOCUSED_KEY, focusedPath)
    }
  }

  componentDidMount() {
    const { browseId, root } = this.props
    const { focusedPath } = this.state
    const { path } = this.props.fileBrowser[browseId]
    if (path === '') {
      const initialPath = focusedPath ? pathApi.parse(focusedPath).dir : root

      this.props.dispatch(changePath(browseId, initialPath))
    } else {
      this.props.dispatch(getFiles(browseId, path))
    }

    // Focus *something* when browser is opened, because if we don't, whatever was focused before
    // the browser was opened will still have focus and will mess with our keyboard events.
    this.focusTimeout = setTimeout(() => {
      this.browserRef.current.focus()
      this.focusTimeout = null
    }, 0)

    window.addEventListener('beforeunload', this._saveToLocalStorage)
  }

  componentDidUpdate(prevProps) {
    const { browseId } = this.props
    const { focusedPath } = this.state
    const { path, isRequesting } = this.props.fileBrowser[browseId]
    const { path: prevPath, isRequesting: prevIsRequesting } = prevProps.fileBrowser[browseId]
    if (prevPath !== path) {
      this.props.dispatch(getFiles(browseId, path))
    }

    const hasFocusedPath = items => items.map(i => i.path).includes(focusedPath)
    const entries = this.getEntries(this.props)

    if (prevIsRequesting && !isRequesting && entries.size > 0) {
      if (hasFocusedPath(entries)) {
        const focusedIndex = entries.findIndex(f => f.path === focusedPath)
        this._scrollToIndex(focusedIndex)
      } else {
        // Focus first entry if nothing else is focused. Will be 'Up one directory' entry in all
        // non-root folders. In the root folder it will either be the first folder or a file.
        this.setState({ focusedPath: entries.get(0).path })
      }
    }
  }

  componentWillUnmount() {
    if (this.focusTimeout) {
      clearTimeout(this.focusTimeout)
    }
    // Saves the focused path to the local storage if the component had time to unmount. If it
    // didn't, eg. the page was refreshed, the 'beforeunload' event listener will handle it.
    this._saveToLocalStorage()
    window.removeEventListener('beforeunload', this._saveToLocalStorage)
  }

  renderFiles() {
    if (!this.contentRef.current) return null
    const { isRequesting, lastError, path, files, folders } = this.props.fileBrowser[
      this.props.browseId
    ]
    const { focusedPath } = this.state
    if (isRequesting) {
      return (
        <div className={styles.loading}>
          <LoadingIndicator />
        </div>
      )
    }

    if (lastError) {
      return <p>{lastError.message}</p>
    }

    const isRootFolder = path === this.props.root
    const upOneDir = isRootFolder
      ? new List([])
      : new List([
          <UpOneDir
            onClick={this.onUpLevelClick}
            isFocused={focusedPath === path + '\\..'}
            key={'up-one-dir'}
          />,
        ])
    const entries = upOneDir.concat(
      folders.map((folder, i) => (
        <FolderEntry
          folder={folder}
          onClick={this.onFolderClick}
          isFocused={folder.path === focusedPath}
          key={folder.path}
        />
      )),
      files.map((file, i) => {
        if (this.props.fileTypes[file.extension]) {
          const { icon } = this.props.fileTypes[file.extension]
          return (
            <FileEntry
              file={file}
              onClick={this.onFileClick}
              isFocused={file.path === focusedPath}
              icon={icon}
              key={file.path}
            />
          )
        } else {
          return null
        }
      }),
    )
    const _rowRenderer = ({ index, style }) => {
      const file = entries.get(index)

      return React.cloneElement(file, { ...file.props, style })
    }

    const clientHeight = this.contentRef.current.getClientHeight()
    return (
      <div className={styles.fileList}>
        <KeyListener onKeyDown={this.onKeyDown} />
        <VirtualizedList
          ref={this.listRef}
          height={clientHeight}
          rowCount={entries.size - 1}
          rowHeight={ENTRY_HEIGHT}
          rowRenderer={_rowRenderer}
          width={768}
          style={{ overflowX: false, overflowY: false }}
        />
      </div>
    )
  }

  render() {
    const { rootFolderName, title, root, error } = this.props
    const { path } = this.props.fileBrowser[this.props.browseId]
    const displayedPath = `${rootFolderName}\\${pathApi.relative(root, path)}`
    return (
      <div ref={this.browserRef} tabIndex='-1' className={styles.root}>
        <div className={styles.topBar}>
          <div className={styles.title}>
            <h3 className={styles.contentTitle}>{title}</h3>
          </div>
          <div className={styles.breadcrumbsAndActions}>
            <PathBreadcrumbs
              className={styles.path}
              path={displayedPath}
              onNavigate={this.onBreadcrumbNavigate}
            />
            <IconButton icon={<Refresh />} onClick={this.onRefreshClick} title={'Refresh'} />
          </div>
        </div>
        {error ? <div className={styles.externalError}>{error}</div> : null}
        <ScrollableContent
          ref={this.contentRef}
          className={styles.filesScrollable}
          viewClassName={styles.filesScrollableView}
          onScroll={this.onScroll}>
          {this.renderFiles()}
        </ScrollableContent>
      </div>
    )
  }

  onBreadcrumbNavigate = path => {
    const { root } = this.props
    const pathWithoutRoot = path.slice(this.props.rootFolderName.length + 1)
    this.props.dispatch(changePath(this.props.browseId, pathApi.join(root, pathWithoutRoot)))
  }

  onUpLevelClick = () => {
    const { path } = this.props.fileBrowser[this.props.browseId]
    const prevPath = path.lastIndexOf('\\') !== -1 ? path.slice(0, path.lastIndexOf('\\')) : ''
    this.props.dispatch(changePath(this.props.browseId, prevPath))
  }

  onFolderClick = folder => {
    this.props.dispatch(changePath(this.props.browseId, folder.path))
  }

  onFileClick = file => {
    const { onSelect } = this.props.fileTypes[file.extension]
    const { focusedPath } = this.state
    if (focusedPath !== file.path) {
      this.setState({ focusedPath: file.path })
    }
    onSelect(file)
  }

  onRefreshClick = () => {
    this.props.dispatch(
      getFiles(this.props.browseId, this.props.fileBrowser[this.props.browseId].path),
    )
  }

  _onEnterPressed = () => {
    const { path, files, folders } = this.props.fileBrowser[this.props.browseId]
    const { focusedPath } = this.state

    if (focusedPath === path + '\\..') {
      this.onUpLevelClick()
      return
    }
    let focusedEntry = folders.find(f => f.path === focusedPath)
    if (focusedEntry) {
      this.onFolderClick(focusedEntry)
      return
    }
    focusedEntry = files.find(f => f.path === focusedPath)
    if (focusedEntry) this.onFileClick(focusedEntry)
  }

  _moveFocusedIndexBy = delta => {
    const { focusedPath } = this.state
    const { scrollToTop, scrollToBottom } = this.contentRef.current

    const entries = this.getEntries(this.props)
    const focusedIndex = entries.findIndex(f => f.path === focusedPath)
    if (focusedIndex === -1) return

    let newIndex = focusedIndex + delta
    if (newIndex < 0) {
      newIndex = 0
      scrollToTop()
    } else if (newIndex > entries.size - 1) {
      newIndex = entries.size - 1
      scrollToBottom()
    }

    if (newIndex === focusedIndex) return

    const newFocusedEntry = entries.get(newIndex)

    if (newFocusedEntry.path !== focusedPath) {
      this.setState({ focusedPath: newFocusedEntry.path })
    }

    this._scrollToIndex(newIndex)
  }

  _scrollToIndex = index => {
    const { getClientHeight, getScrollTop, scrollTop } = this.contentRef.current

    const clientHeight = getClientHeight()
    const ENTRIES_SHOWN = Math.floor(clientHeight / ENTRY_HEIGHT)

    // Adjust scroll position to keep the item in view
    // TODO(2Pac): This was taken from the Select component, with some minor adjustments. Try
    // extracting this logic (along with anything else needed) into some kind of a List component.
    const curTopIndex = Math.ceil(Math.max(0, getScrollTop() - VERT_PADDING) / ENTRY_HEIGHT)
    const curBottomIndex = curTopIndex + ENTRIES_SHOWN - 1 // accounts for partially shown entries
    if (index >= curTopIndex && index <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (index < curTopIndex) {
      // Make the new index the top item
      scrollTop(VERT_PADDING + ENTRY_HEIGHT * index)
    } else {
      // Calculates the space used to display a partially shown entry, so the bottom entry is
      // aligned to the bottom of the list
      const partialHeight = clientHeight - VERT_PADDING - ENTRIES_SHOWN * ENTRY_HEIGHT
      // Make the new index the bottom item
      scrollTop(ENTRY_HEIGHT * (index + 1 - ENTRIES_SHOWN) - partialHeight)
    }
  }

  onKeyDown = event => {
    const { focusedPath } = this.state

    switch (event.which) {
      case ENTER:
        this._onEnterPressed()
        return true
      case UP:
        this._moveFocusedIndexBy(-1)
        return true
      case DOWN:
        this._moveFocusedIndexBy(1)
        return true
      case PAGEUP:
      case PAGEDOWN:
        const ENTRIES_SHOWN = Math.floor(this.contentRef.current.getClientHeight() / ENTRY_HEIGHT)
        // This tries to mimick the way "page up" and "page down" keys work in Windows file explorer
        const delta = event.which === PAGEUP ? -ENTRIES_SHOWN + 1 : ENTRIES_SHOWN - 1
        this._moveFocusedIndexBy(delta)
        return true
      case HOME:
      case END:
        const entries = this.getEntries(this.props)
        const newFocusedEntry = event.which === HOME ? entries.first() : entries.last()
        if (!newFocusedEntry || newFocusedEntry.path === focusedPath) return true

        this.setState({ focusedPath: newFocusedEntry.path })
        if (event.which === HOME) this.contentRef.current.scrollToTop()
        else if (event.which === END) this.contentRef.current.scrollToBottom()
        return true
    }

    return false
  }

  onScroll = event => {
    const { scrollTop, scrollLeft } = event.target
    const { Grid: grid } = this.listRef.current

    grid.handleScrollEvent({ scrollTop, scrollLeft })
  }
}
