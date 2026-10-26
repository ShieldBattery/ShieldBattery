import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { Tooltip, TooltipPosition } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { usePlayerNote } from './player-notes'

const NoteIconButton = styled(IconButton)<{ $hasNote: boolean }>`
  color: ${props => (props.$hasNote ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};

  &:hover {
    color: var(--theme-amber);
  }
`

const NoteText = styled.span`
  /* Notes are free-form text, so keep the line breaks the user typed and wrap anything long. */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 12;
  overflow: hidden;

  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-align: start;
`

export interface PlayerNoteButtonProps {
  userId: SbUserId
  className?: string
  tooltipPosition?: TooltipPosition
}

/**
 * An icon button that shows the current user's private note about a player as its tooltip, and
 * opens a dialog to write or edit that note when clicked.
 */
export function PlayerNoteButton({ userId, className, tooltipPosition }: PlayerNoteButtonProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [note] = usePlayerNote(userId)
  const hasNote = note !== undefined

  return (
    <Tooltip
      className={className}
      // Focus goes to the button inside; the wrapper only needs to observe it to show the tooltip.
      tabIndex={-1}
      position={tooltipPosition}
      text={hasNote ? <NoteText>{note}</NoteText> : t('users.playerNote.add', 'Add a note')}>
      <NoteIconButton
        $hasNote={hasNote}
        icon={<MaterialIcon icon='sticky_note_2' filled={hasNote} />}
        ariaLabel={
          hasNote
            ? t('users.playerNote.edit', 'Edit note')
            : t('users.playerNote.add', 'Add a note')
        }
        ariaHasPopup='dialog'
        testName='player-note-button'
        onClick={event => {
          // Player rows open overlays on click, so keep this click from reaching them.
          event.stopPropagation()
          dispatch(openDialog({ type: DialogType.PlayerNote, initData: { userId } }))
        }}
      />
    </Tooltip>
  )
}
