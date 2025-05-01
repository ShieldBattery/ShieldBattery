import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import prettyBytes from 'pretty-bytes'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { FocusTrap } from '../dom/focus-trap'
import { FilledButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Portal } from '../material/portal'
import { zIndexDialogScrim } from '../material/zindex'
import { makeServerUrl } from '../network/server-url'
import { LoadingDotsArea } from '../progress/dots'
import { BodyLarge, BodyMedium } from '../styles/typography'
import {
  UpdateProgress,
  UpdateStateChangeHandler,
  addChangeHandler,
  removeChangeHandler,
} from './updater-state'

const ipcRenderer = new TypedIpcRenderer()

const Scrim = styled(m.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0px);
  right: 0;
  bottom: 0;

  background: var(--theme-dialog-scrim);
  z-index: ${zIndexDialogScrim};

  -webkit-app-region: no-drag;
`

const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 0.84 },
}

const scrimTransition: Transition = {
  type: 'spring',
  duration: 0.3,
  bounce: 0,
}

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

  return (
    <AnimatePresence>
      {hasUpdate && (
        <Portal open={true}>
          <Scrim
            variants={scrimVariants}
            initial='hidden'
            animate='visible'
            exit='hidden'
            transition={scrimTransition}
          />

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
        </Portal>
      )}
    </AnimatePresence>
  )
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
      <BodyLarge>
        <Trans t={t} i18nKey='clientUpdate.overlay.errorBody'>
          There was an error downloading the update. Please restart and try again, or visit{' '}
          <a href={makeServerUrl('/')} target='_blank' rel='noopener noreferrer'>
            our website
          </a>{' '}
          to download the latest version.
        </Trans>
      </BodyLarge>
    )
  } else if (readyToInstall) {
    content = (
      <Content>
        <BodyLarge>
          {t(
            'clientUpdate.overlay.newUpdateReady',
            'A new update has been downloaded and is ready to install. ' +
              'Please restart the application to continue.',
          )}
        </BodyLarge>
        <FilledButton
          onClick={() => ipcRenderer.send('updaterQuitAndInstall')}
          label={t('clientUpdate.overlay.restartNow', 'Restart now')}
        />
      </Content>
    )
  } else if (hasUpdate) {
    content = (
      <Content>
        <BodyLarge>
          {t(
            'clientUpdate.overlay.newUpdateDownloading',
            'A new update is being downloaded. ' +
              'Please wait for the download to complete in order to continue.',
          )}
        </BodyLarge>
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
  background-color: var(--theme-amber);
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
  const { t } = useTranslation()
  const { totalBytes, bytesTransferred, bytesPerSecond } = progress

  const prettyTotalBytes = prettyBytes(totalBytes)
  const prettyBytesTransferred = prettyBytes(bytesTransferred)
  const prettyBytesPerSecond = prettyBytes(bytesPerSecond)

  return (
    <ProgressContainer>
      <ProgressBar>
        <FilledProgressBar $filledScale={bytesTransferred / totalBytes} />
      </ProgressBar>
      <BodyMedium>
        <Trans t={t} i18nKey='clientUpdate.overlay.progress'>
          {{ transferred: prettyBytesTransferred }} / {{ total: prettyTotalBytes }} at{' '}
          {{ perSecond: prettyBytesPerSecond }}/s
        </Trans>
      </BodyMedium>
    </ProgressContainer>
  )
}
