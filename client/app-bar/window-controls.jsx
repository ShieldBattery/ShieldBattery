import React from 'react'
import ReactDOM from 'react-dom'
import styled, { css } from 'styled-components'

import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import MaximizeIcon from '../icons/material/ic_fullscreen_black_24px.svg'
import MinimizeIcon from '../icons/material/ic_remove_black_24px.svg'

import { reset } from '../material/button-reset'
import { zIndexWindowControls } from '../material/zindex'

import { WINDOW_CLOSE, WINDOW_MAXIMIZE, WINDOW_MINIMIZE } from '../../app/common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

export const windowControlsHeight = IS_ELECTRON ? '32px' : '0px'

const root = `
  position: absolute;
  top: 0;
  right: 0;
  z-index: ${zIndexWindowControls};
`

const button = css`
  ${reset};
  width: 48px;
  height: ${windowControlsHeight};
  line-height: ${windowControlsHeight};
  padding: 4px 12px;
  float: right;
  cursor: pointer;

  -webkit-app-region: no-drag;

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.16);
  }
`

const CloseButton = styled.button`
  ${button};

  &:hover {
    background-color: rgba(244, 67, 54, 0.8); /* red 500 */
  }

  &:active {
    background-color: rgba(244, 67, 54, 0.88); /* red 500 */
  }
`

const MaximizeButton = styled.button`
  ${button};
`

const MinimizeButton = styled.button`
  ${button};
`

const sizeBase = css`
  -webkit-app-region: no-drag;
  position: absolute;
  z-index: 1000;

  .maximized & {
    display: none;
    -webkit-app-region: inherit;
  }
`

export const SizeTop = styled.div`
  ${sizeBase};
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
`

export const SizeLeft = styled.div`
  ${sizeBase};
  width: 4px;
  top: 0;
  left: 0;
  bottom: 0;
`

export const SizeRight = styled.div`
  ${sizeBase};
  width: 4px;
  top: 0;
  right: 0;
  bottom: 0;
`

export default class WindowControls extends React.Component {
  controls = null

  componentWillUnmount() {
    this.removeWindowControls()
  }

  render() {
    if (!IS_ELECTRON) {
      return null
    }

    if (!this.controls) {
      this.controls = document.createElement('div')
      // We use inline style here so we don't have to create another DOM element
      this.controls.setAttribute('style', root)
      document.body.appendChild(this.controls)
    }

    const contents = (
      <React.Fragment>
        <CloseButton title={'Close'} onClick={this.onCloseClick}>
          <CloseIcon />
        </CloseButton>
        <MaximizeButton title={'Maximize/Restore'} onClick={this.onMaximizeClick}>
          <MaximizeIcon />
        </MaximizeButton>
        <MinimizeButton title={'Minimize'} onClick={this.onMinimizeClick}>
          <MinimizeIcon />
        </MinimizeButton>
      </React.Fragment>
    )

    // The reason why we're using portals to render window controls is so we can ensure they always
    // stay on top of other components, even dialogs and other components that use portals
    return ReactDOM.createPortal(contents, this.controls)
  }

  removeWindowControls() {
    if (!IS_ELECTRON || !this.controls) return

    document.body.removeChild(this.controls)
    this.controls = null
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
  }

  onMaximizeClick = () => {
    ipcRenderer.send(WINDOW_MAXIMIZE)
  }

  onMinimizeClick = () => {
    ipcRenderer.send(WINDOW_MINIMIZE)
  }
}
