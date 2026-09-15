import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThunkAction } from '../../dispatch-registry'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { useAppDispatch } from '../../redux-hooks'
import { LocalLineButton } from './local-button'
import { LocalStrong } from './local-strong'

export interface UndoLineProps {
  /** What the line says once the action has happened. */
  content: React.ReactNode
  /** What the line says after a successful Undo (no further Undo is offered). */
  undoneContent: React.ReactNode
  /** Starts the reversing request; the returned thunk is dispatched with the spec handed in. */
  undo: (spec: RequestHandlingSpec<void>) => ThunkAction
  /** Answers an Undo that failed, as a separate error line (the info line itself stays as it was). */
  onUndoError: (err: Error) => void
}

/**
 * A line that says what just happened and offers to reverse it. Only the one Undo is offered: once
 * it goes through the line says so and the button is gone, so the pair can't be flipped back and
 * forth from a line that has already scrolled up the conversation.
 */
export function UndoLine({ content, undoneContent, undo, onUndoError }: UndoLineProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [state, setState] = useState<'idle' | 'pending' | 'undone'>('idle')

  if (state === 'undone') {
    return <>{undoneContent}</>
  }

  return (
    <>
      {content}{' '}
      <LocalLineButton
        disabled={state === 'pending'}
        onClick={() => {
          setState('pending')
          dispatch(
            undo({
              onSuccess: () => setState('undone'),
              onError: err => {
                setState('idle')
                onUndoError(err)
              },
            }),
          )
        }}>
        <LocalStrong>{t('common.actions.undo', 'Undo')}</LocalStrong>
      </LocalLineButton>
    </>
  )
}
