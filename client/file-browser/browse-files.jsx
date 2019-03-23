import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import classnames from 'classnames'
import pathApi from 'path'

import styles from './browse-files.css'
import { changePath, getFiles } from './action-creators'

import ChevronRight from '../icons/material/ic_chevron_right_black_24px.svg'
import Folder from '../icons/material/ic_folder_black_24px.svg'
import Refresh from '../icons/material/ic_refresh_black_24px.svg'
import UpDirectory from '../icons/material/ic_subdirectory_arrow_left_black_24px.svg'

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

class FolderEntry extends React.Component {
  static propTypes = {
    folder: PropTypes.object.isRequired,
    onClick: PropTypes.func.isRequired,
    isFocused: PropTypes.bool,
  }

  shouldComponentUpdate(nextProps) {
    return nextProps.folder !== this.props.folder || nextProps.onClick !== this.props.onClick
  }

  render() {
    const { folder, onClick } = this.props
    const classes = classnames(styles.entry, styles.folder, {
      [styles.focused]: this.props.isFocused,
    })

    return (
      <div className={classes} onClick={() => onClick(folder)}>
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

class FileEntry extends React.Component {
  static propTypes = {
    file: PropTypes.object.isRequired,
    onClick: PropTypes.func.isRequired,
    isFocused: PropTypes.bool,
  }

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps.file !== this.props.file || nextProps.onClick !== this.props.onClick
  }

  render() {
    const { file, onClick, icon } = this.props
    const classes = classnames(styles.entry, styles.file, {
      [styles.focused]: this.props.isFocused,
    })

    return (
      <div className={classes} onClick={() => onClick(file)}>
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
  componentDidMount() {
    const { browseId, root } = this.props
    const { path } = this.props.fileBrowser[browseId]
    if (path === '') {
      this.props.dispatch(changePath(browseId, root))
    } else {
      this.props.dispatch(getFiles(browseId, path))
    }
  }

  componentDidUpdate(prevProps) {
    const { browseId } = this.props
    const { path } = this.props.fileBrowser[browseId]
    if (prevProps.fileBrowser[browseId].path !== path) {
      this.props.dispatch(getFiles(browseId, path))
    }
  }

  renderFiles() {
    const { isRequesting, lastError, path, files, folders } = this.props.fileBrowser[
      this.props.browseId
    ]
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

    return (
      <div className={styles.fileList}>
        {!isRootFolder ? (
          <div className={styles.entry} onClick={this.onUpLevelClick} key={'up-one-dir'}>
            <div className={styles.entryIcon}>
              <UpDirectory />
            </div>
            <div className={styles.name}>{'Up one directory'}</div>
          </div>
        ) : null}
        {folders.map((folder, i) => (
          <FolderEntry folder={folder} onClick={this.onFolderClick} key={folder.path} />
        ))}
        {files.map((file, i) => {
          const extension = file.path.substr(file.path.lastIndexOf('.') + 1).toLowerCase()
          if (this.props.fileTypes[extension]) {
            const { onSelect, icon } = this.props.fileTypes[extension]
            return <FileEntry file={file} onClick={onSelect} icon={icon} key={file.path} />
          } else {
            return null
          }
        })}
      </div>
    )
  }

  render() {
    const { rootFolderName, title, root, error } = this.props
    const { path } = this.props.fileBrowser[this.props.browseId]
    const displayedPath = `${rootFolderName}\\${pathApi.relative(root, path)}`
    return (
      <div className={styles.root}>
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
          className={styles.filesScrollable}
          viewClassName={styles.filesScrollableView}>
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

  onRefreshClick = () => {
    this.props.dispatch(
      getFiles(this.props.browseId, this.props.fileBrowser[this.props.browseId].path),
    )
  }
}
