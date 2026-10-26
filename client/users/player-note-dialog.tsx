import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useAutoFocusRef } from '../material/auto-focus'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { useAppSelector } from '../redux-hooks'
import { bodyMedium } from '../styles/typography'
import { PLAYER_NOTE_MAX_LENGTH, usePlayerNote } from './player-notes'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Description = styled.p`
  ${bodyMedium};
  margin: 0 0 16px;
  color: var(--theme-on-surface-variant);
`

export interface PlayerNoteDialogProps extends CommonDialogProps {
  userId: SbUserId
}

export function PlayerNoteDialog({ userId, onCancel, close }: PlayerNoteDialogProps) {
  const { t } = useTranslation()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const [storedNote, storeNote] = usePlayerNote(userId)
  const [draft, setDraft] = useState(storedNote ?? '')
  const inputRef = useAutoFocusRef<HTMLTextAreaElement>()

  const save = () => {
    storeNote(draft)
    close()
  }

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
  ]
  if (storedNote !== undefined) {
    buttons.push(
      <TextButton
        key='delete'
        label={t('users.playerNote.delete', 'Delete note')}
        testName='player-note-delete'
        onClick={() => {
          storeNote(undefined)
          close()
        }}
      />,
    )
  }
  buttons.push(
    <TextButton
      key='save'
      label={t('common.actions.save', 'Save')}
      testName='player-note-save'
      onClick={save}
    />,
  )

  return (
    <StyledDialog
      title={
        username
          ? t('users.playerNote.titleWithName', {
              defaultValue: 'Note for {{username}}',
              username,
            })
          : t('users.playerNote.title', 'Player note')
      }
      onCancel={onCancel}
      buttons={buttons}
      testName='player-note-dialog'>
      <Description>
        {t(
          'users.playerNote.description',
          'Only you can see this note. It is saved on this device.',
        )}
      </Description>
      <TextField
        ref={inputRef}
        value={draft}
        multiline={true}
        rows={4}
        maxRows={10}
        maxLength={PLAYER_NOTE_MAX_LENGTH}
        floatingLabel={true}
        label={t('users.playerNote.label', 'Note')}
        testName='player-note-input'
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          // Enter adds a line break in the note; Ctrl/Cmd+Enter saves it.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            save()
          }
        }}
      />
    </StyledDialog>
  )
}
