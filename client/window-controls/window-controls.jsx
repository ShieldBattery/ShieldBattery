import React from 'react'
import classnames from 'classnames'
import styles from './window-controls.css'

import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import MaximizeIcon from '../icons/material/ic_fullscreen_black_24px.svg'
import MinimizeIcon from '../icons/material/ic_remove_black_24px.svg'

import {
  WINDOW_CLOSE,
  WINDOW_MAXIMIZE,
  WINDOW_MINIMIZE,
} from '../../app/common/ipc-constants'

const ipcRenderer =
    process.webpackEnv.SB_ENV === 'electron' ? require('electron').ipcRenderer : null

export default class WindowControls extends React.Component {
  render() {
    if (process.webpackEnv.SB_ENV !== 'electron') {
      return null
    }

    const classes = classnames(this.props.className, styles.root)

    return (<div className={classes}>
      <div className={styles.sizeTop} />
      <div className={styles.sizeLeft} />
      <div className={styles.sizeRight} />
      <button title={'Close'} className={styles.closeButton} onClick={this.onCloseClick}>
        <CloseIcon/>
      </button>
      <button title={'Maximize/Restore'} className={styles.maximizeButton}
        onClick={this.onMaximizeClick}>
        <MaximizeIcon/>
      </button>
      <button title={'Minimize'} className={styles.minimizeButton} onClick={this.onMinimizeClick}>
        <MinimizeIcon/>
      </button>
    </div>)
  }

  onCloseClick = () => {
    let shouldDisplayCloseHint
    const KEY = 'closeHintShown'
    const val = window.localStorage.getItem(KEY)
    if (!val) {
      shouldDisplayCloseHint = true
      window.localStorage.setItem(KEY, true)
    } else {
      shouldDisplayCloseHint = false
    }
    ipcRenderer.send(WINDOW_CLOSE, shouldDisplayCloseHint)
  };

  onMaximizeClick = () => {
    ipcRenderer.send(WINDOW_MAXIMIZE)
  };

  onMinimizeClick = () => {
    ipcRenderer.send(WINDOW_MINIMIZE)
  };
}
