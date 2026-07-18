import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { composeValidators, maxLength, required } from '../forms/validators'
import { useAutoFocusRef } from '../material/auto-focus'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge } from '../styles/typography'

const ipcRenderer = new TypedIpcRenderer()

const MAX_PLAYLIST_NAME_LENGTH = 64

const playlistNameValidator = composeValidators(
  required(t => t('replays.library.playlist.nameRequired', 'Enter a playlist name')),
  maxLength(MAX_PLAYLIST_NAME_LENGTH),
)

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
  margin-bottom: 16px;
`

const Body = styled.div`
  ${bodyLarge};
`

interface PlaylistNameFormModel {
  name: string
}

export interface CreatePlaylistDialogProps extends CommonDialogProps {
  onCreated: (id: number, name: string) => void
}

/** A create-name dialog for a new playlist, mirroring `client/whispers/create-whisper.tsx`. */
export function CreatePlaylistDialog({ onCancel, close, onCreated }: CreatePlaylistDialogProps) {
  const { t } = useTranslation()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const [submitting, setSubmitting] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  const { submit, bindInput, form } = useForm<PlaylistNameFormModel>(
    { name: '' },
    { name: playlistNameValidator },
  )

  useFormCallbacks(form, {
    onSubmit: ({ name }) => {
      setSubmitting(true)
      ipcRenderer
        .invoke('replayLibraryCreatePlaylist', name)
        ?.then(id => {
          onCreated(id, name)
          close()
        })
        .catch(err => {
          setSubmitting(false)
          setLastError(err)
        })
    },
  })

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton label={t('common.actions.create', 'Create')} key='create' onClick={submit} />,
  ]

  return (
    <StyledDialog
      title={t('replays.library.playlist.createTitle', 'New playlist')}
      buttons={buttons}
      onCancel={onCancel}>
      {submitting ? (
        <LoadingDotsArea />
      ) : (
        <>
          {lastError ? (
            <ErrorText>
              {t('replays.library.playlist.createError', {
                defaultValue: 'Error creating playlist: {{errorMessage}}',
                errorMessage: lastError.message,
              })}
            </ErrorText>
          ) : undefined}
          <form noValidate={true} onSubmit={submit}>
            <TextField
              {...bindInput('name')}
              label={t('replays.library.playlist.nameLabel', 'Playlist name')}
              floatingLabel={true}
              ref={inputRef}
              inputProps={{
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
                tabIndex: 0,
                maxLength: MAX_PLAYLIST_NAME_LENGTH,
              }}
            />
          </form>
        </>
      )}
    </StyledDialog>
  )
}

export interface RenamePlaylistDialogProps extends CommonDialogProps {
  playlistId: number
  currentName: string
}

export function RenamePlaylistDialog({
  onCancel,
  close,
  playlistId,
  currentName,
}: RenamePlaylistDialogProps) {
  const { t } = useTranslation()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const [submitting, setSubmitting] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  const { submit, bindInput, form } = useForm<PlaylistNameFormModel>(
    { name: currentName },
    { name: playlistNameValidator },
  )

  useFormCallbacks(form, {
    onSubmit: ({ name }) => {
      setSubmitting(true)
      ipcRenderer
        .invoke('replayLibraryRenamePlaylist', playlistId, name)
        ?.then(() => {
          close()
        })
        .catch(err => {
          setSubmitting(false)
          setLastError(err)
        })
    },
  })

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton label={t('common.actions.save', 'Save')} key='save' onClick={submit} />,
  ]

  return (
    <StyledDialog
      title={t('replays.library.playlist.renameTitle', 'Rename playlist')}
      buttons={buttons}
      onCancel={onCancel}>
      {submitting ? (
        <LoadingDotsArea />
      ) : (
        <>
          {lastError ? (
            <ErrorText>
              {t('replays.library.playlist.renameError', {
                defaultValue: 'Error renaming playlist: {{errorMessage}}',
                errorMessage: lastError.message,
              })}
            </ErrorText>
          ) : undefined}
          <form noValidate={true} onSubmit={submit}>
            <TextField
              {...bindInput('name')}
              label={t('replays.library.playlist.nameLabel', 'Playlist name')}
              floatingLabel={true}
              ref={inputRef}
              inputProps={{
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
                tabIndex: 0,
                maxLength: MAX_PLAYLIST_NAME_LENGTH,
              }}
            />
          </form>
        </>
      )}
    </StyledDialog>
  )
}

export interface DeletePlaylistDialogProps extends CommonDialogProps {
  playlistId: number
  name: string
}

export function DeletePlaylistDialog({
  onCancel,
  close,
  playlistId,
  name,
}: DeletePlaylistDialogProps) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [lastError, setLastError] = useState<Error>()

  const onDelete = () => {
    setDeleting(true)
    ipcRenderer
      .invoke('replayLibraryDeletePlaylist', playlistId)
      ?.then(() => {
        close()
      })
      .catch(err => {
        setDeleting(false)
        setLastError(err)
      })
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={deleting}
    />,
    <TextButton
      label={t('common.actions.delete', 'Delete')}
      key='delete'
      onClick={onDelete}
      disabled={deleting}
    />,
  ]

  return (
    <StyledDialog
      title={t('replays.library.playlist.deleteTitle', 'Delete playlist?')}
      buttons={buttons}
      onCancel={onCancel}>
      {lastError ? (
        <ErrorText>
          {t('replays.library.playlist.deleteError', {
            defaultValue: 'Error deleting playlist: {{errorMessage}}',
            errorMessage: lastError.message,
          })}
        </ErrorText>
      ) : undefined}
      <Body>
        {t(
          'replays.library.playlist.deleteBody',
          'Delete "{{name}}"? Its entries will be removed, but the replay files on disk will not be affected.',
          { name },
        )}
      </Body>
    </StyledDialog>
  )
}
