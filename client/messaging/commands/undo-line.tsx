import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ThunkAction } from '../../dispatch-registry'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { useAppDispatch } from '../../redux-hooks'
import { LocalStrong } from './local-strong'

/**
 * The Undo affordance itself, typeset as part of the sentence it ends rather than as a control of
 * its own: the browser's button chrome is stripped and the colour is inherited, so the `LocalStrong`
 * inside it takes whatever colour the surrounding line gives its strong parts.
 */
const UndoButton = styled.button.attrs({ type: 'button' })`
  background: none;
  border: 0;
  margin: 0;
  padding: 0;
  color: inherit;
  text-align: inherit;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`

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
      <UndoButton
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
      </UndoButton>
    </>
  )
}
