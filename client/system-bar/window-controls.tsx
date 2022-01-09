import React, { useCallback } from 'react'
import ReactDOM from 'react-dom'
import styled, { createGlobalStyle, css } from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import CloseIcon from '../icons/codicons/chrome-close.svg'
import MaximizeIcon from '../icons/codicons/chrome-maximize.svg'
import MinimizeIcon from '../icons/codicons/chrome-minimize.svg'
import { buttonReset } from '../material/button-reset'
import { zIndexWindowControls } from '../material/zindex'

const ipcRenderer = new TypedIpcRenderer()

export const windowControlsHeight = IS_ELECTRON ? '24px' : '0px'

export const WindowControlsStyle = createGlobalStyle`
  .sb-window-controls {
    position: absolute;
    top: 0;
    right: 0;
    z-index: ${zIndexWindowControls};
  }
`

const button = css`
  ${buttonReset};
  width: 48px;
  height: ${windowControlsHeight};
  padding: 4px 0;

  cursor: pointer;
  float: right;
  line-height: ${windowControlsHeight};
  text-align: center;
  vertical-align: center;

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

export function WindowControls() {
  const container = useExternalElementRef(elem => {
    elem.classList.add('sb-window-controls')
  })
  const onCloseClick = useCallback(() => {
    let shouldDisplayCloseHint
    const KEY = 'closeHintShown'
    const val = window.localStorage.getItem(KEY)
    if (!val) {
      shouldDisplayCloseHint = true
      window.localStorage.setItem(KEY, 'true')
    } else {
      shouldDisplayCloseHint = false
    }
    ipcRenderer.send('windowClose', shouldDisplayCloseHint)
  }, [])
  const onMaximizeClick = useCallback(() => {
    ipcRenderer.send('windowMaximize')
  }, [])
  const onMinimizeClick = useCallback(() => {
    ipcRenderer.send('windowMinimize')
  }, [])

  // The reason why we're using portals to render window controls is so we can ensure they always
  // stay on top of other components, even dialogs and other components that use portals
  return ReactDOM.createPortal(
    <>
      <WindowControlsStyle />
      <CloseButton title={'Close'} onClick={onCloseClick}>
        <CloseIcon />
      </CloseButton>
      <MaximizeButton title={'Maximize/Restore'} onClick={onMaximizeClick}>
        <MaximizeIcon />
      </MaximizeButton>
      <MinimizeButton title={'Minimize'} onClick={onMinimizeClick}>
        <MinimizeIcon />
      </MinimizeButton>
    </>,
    container.current,
  )
}
