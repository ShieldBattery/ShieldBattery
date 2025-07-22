import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbMapId } from '../../common/maps'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { getMapDownloadUrl } from './action-creators'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

interface MapDownloadDialogProps extends CommonDialogProps {
  mapId: SbMapId
}

export function MapDownloadDialog({ mapId, onCancel }: MapDownloadDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [error, setError] = useState<Error | null>(null)
  // NOTE(tec27): We need this instead of the normal onCancel because this dialog is marked as modal
  // so onCancel does nothing. At some point we should probably clean things up so that the dialog
  // itself manages that status :)
  const close = useCallback(() => {
    dispatch(closeDialog(DialogType.MapDownload))
  }, [dispatch])

  useEffect(() => {
    const abortController = new AbortController()
    dispatch(
      getMapDownloadUrl(mapId, {
        signal: abortController.signal,
        onSuccess: url => {
          const a = document.createElement('a')
          a.href = url
          a.target = '_blank'
          a.click()
          close()
        },
        onError: error => {
          setError(error)
        },
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [close, dispatch, mapId])

  return (
    <StyledDialog
      onCancel={onCancel}
      title={t('map.download.dialogTitle', 'Downloading map…')}
      buttons={
        error
          ? [<TextButton key='okay' onClick={close} label={t('common.action.close', 'Close')} />]
          : undefined
      }>
      {error ? (
        <ErrorText>
          {t(
            'map.download.urlError',
            'There was a problem retrieving the download link. Please try again later.',
          )}
        </ErrorText>
      ) : (
        <LoadingDotsArea />
      )}
    </StyledDialog>
  )
}
