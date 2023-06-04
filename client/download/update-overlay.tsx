import { rgba } from 'polished'
import prettyBytes from 'pretty-bytes'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { animated, useTransition } from 'react-spring'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { FocusTrap } from '../dom/focus-trap'
import { RaisedButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Portal } from '../material/portal'
import { defaultSpring } from '../material/springs'
import { zIndexDialogScrim } from '../material/zindex'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { amberA400, dialogScrim } from '../styles/colors'
import { Body1, Subtitle1 } from '../styles/typography'
import {
  addChangeHandler,
  removeChangeHandler,
  UpdateProgress,
  UpdateStateChangeHandler,
} from './updater-state'

const ipcRenderer = new TypedIpcRenderer()

const StyledPortal = styled(Portal)`
  z-index: 99999;
`

const Scrim = styled(animated.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const INVISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0)
const VISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0.84)

export function UpdateOverlay() {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [hasDownloadError, setHasDownloadError] = useState(false)
  const [readyToInstall, setReadyToInstall] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress>()
  const focusableRef = useRef<HTMLSpanElement>(null)

  const changeHandler = useCallback<UpdateStateChangeHandler>(state => {
    setHasUpdate(state.hasUpdate)
    setHasDownloadError(state.hasDownloadError)
    setReadyToInstall(state.readyToInstall)
    setProgress(state.progress)
  }, [])

  const scrimTransition = useTransition(hasUpdate, {
    from: {
      background: INVISIBLE_SCRIM_COLOR,
    },
    enter: { background: VISIBLE_SCRIM_COLOR },
    leave: { background: INVISIBLE_SCRIM_COLOR },
    config: {
      ...defaultSpring,
      clamp: true,
    },
  })

  useEffect(() => {
    const handler = changeHandler
    addChangeHandler(handler)

    return () => {
      removeChangeHandler(handler)
    }
  }, [changeHandler])

  useEffect(() => {
    if (hasUpdate) {
      focusableRef.current?.focus()
    }
  }, [hasUpdate])

  return hasUpdate ? (
    <StyledPortal open={true}>
      {scrimTransition((styles, open) => open && <Scrim style={styles} />)}

      <FocusTrap focusableRef={focusableRef}>
        <span ref={focusableRef} tabIndex={-1}>
          <UpdateDialog
            hasUpdate={hasUpdate}
            hasDownloadError={hasDownloadError}
            readyToInstall={readyToInstall}
            progress={progress}
          />
        </span>
      </FocusTrap>
    </StyledPortal>
  ) : null
}

const StyledDialog = styled(Dialog)`
  max-width: 480px;
  z-index: 99999;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`

export interface UpdateDialogProps {
  hasUpdate: boolean
  hasDownloadError: boolean
  readyToInstall: boolean
  progress?: UpdateProgress
}

// NOTE(tec27): This is *not* available as a normal connected Dialog, it is only rendered by the
// `UpdateOverlay` component. We expose it for easier testing in dev pages.
export function UpdateDialog({
  hasUpdate,
  hasDownloadError,
  readyToInstall,
  progress,
}: UpdateDialogProps) {
  const { t } = useTranslation()
  const title = !hasDownloadError
    ? t('clientUpdate.overlay.noErrorTitle', 'Update available')
    : t('clientUpdate.overlay.errorTitle', 'Error downloading update')
  let content = <span />
  if (hasDownloadError) {
    content = (
      <Subtitle1>
        <Trans t={t} i18nKey='clientUpdate.overlay.errorBody'>
          There was an error downloading the update. Please restart and try again, or visit{' '}
          <a href={makeServerUrl('/')} target='_blank' rel='noopener noreferrer'>
            our website
          </a>{' '}
          to download the latest version.
        </Trans>
      </Subtitle1>
    )
  } else if (readyToInstall) {
    content = (
      <Content>
        <Subtitle1>
          {t(
            'clientUpdate.overlay.newUpdateReady',
            'A new update has been downloaded and is ready to install. ' +
              'Please restart the application to continue.',
          )}
        </Subtitle1>
        <RaisedButton
          onClick={() => ipcRenderer.send('updaterQuitAndInstall')}
          label={t('clientUpdate.overlay.restartNowLabel', 'Restart now')}
        />
      </Content>
    )
  } else if (hasUpdate) {
    content = (
      <Content>
        <Subtitle1>
          {t(
            'clientUpdate.overlay.newUpdateDownloading',
            'A new update is being downloaded. ' +
              'Please wait for the download to complete in order to continue.',
          )}
        </Subtitle1>
        {progress ? <UpdateProgressUi progress={progress} /> : <LoadingDotsArea />}
      </Content>
    )
  }

  return (
    <StyledDialog title={title} showCloseButton={false}>
      {content}
    </StyledDialog>
  )
}

const ProgressBar = styled.div`
  position: relative;
  width: 100%;
  height: 12px;
  background-color: rgba(255, 255, 255, 0.16);
`

const FilledProgressBar = styled.div<{ $filledScale: number }>`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 12px;
  background-color: ${amberA400};
  transform: ${props => `scaleX(${props.$filledScale})`};
  transform-origin: 0% 50%;
  transition: transform 80ms linear;
  will-change: transform;
`

const ProgressContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: center;
`

function UpdateProgressUi({ progress }: { progress: UpdateProgress }) {
  const { totalBytes, bytesTransferred, bytesPerSecond } = progress

  const prettyTotalBytes = prettyBytes(totalBytes)
  const prettyBytesTransferred = prettyBytes(bytesTransferred)
  const prettyBytesPerSecond = prettyBytes(bytesPerSecond)

  return (
    <ProgressContainer>
      <ProgressBar>
        <FilledProgressBar $filledScale={bytesTransferred / totalBytes} />
      </ProgressBar>
      <Body1>
        {prettyBytesTransferred} / {prettyTotalBytes} at {prettyBytesPerSecond}/s
      </Body1>
    </ProgressContainer>
  )
}
