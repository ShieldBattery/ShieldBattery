import { FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { apiUrl } from '../../common/urls'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useAutoFocusRef } from '../material/auto-focus'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { bodyMedium } from '../styles/typography'
import { parseJoinCodeInput } from './join-code-input'
import { navigateToLobby } from './lobby-url'

const Explainer = styled.div`
  ${bodyMedium};
  margin-bottom: 16px;

  color: var(--theme-on-surface-variant);
`

/**
 * The "enter a join code" escape hatch: takes a join code, a pasted lobby link (https or one of
 * the app's `shieldbattery`-family scheme URLs), or a bare lobby id, and gets the user into that
 * lobby's join proposal surface. See {@link parseJoinCodeInput} for the accepted input shapes.
 */
export function JoinCodeDialog({ onCancel, close }: CommonDialogProps) {
  const { t } = useTranslation()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const [value, setValue] = useState('')
  const [errorText, setErrorText] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const abortControllerRef = useRef<AbortController>(undefined)

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  // A dismissed dialog stays mounted through its exit animation, so aborting only on unmount
  // would leave a window where an in-flight resolution could still succeed and navigate after
  // the user canceled. Cancel aborts synchronously instead.
  const handleCancel = () => {
    abortControllerRef.current?.abort()
    onCancel()
  }

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault()
    if (submitting) {
      return
    }

    const parsed = parseJoinCodeInput(value)
    if (!parsed) {
      setErrorText(t('lobbies.joinCode.invalidInput', 'Enter a code or a lobby link.'))
      return
    }

    if (parsed.kind === 'lobbyId') {
      close()
      navigateToLobby(parsed.id)
      return
    }

    setErrorText(undefined)
    setSubmitting(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    fetchJson<LobbySummaryResponse>(apiUrl`lobbies/join-code/${parsed.code}`, {
      signal: controller.signal,
    })
      .then(response => {
        if (controller.signal.aborted) {
          return
        }
        close()
        navigateToLobby(response.summary.id, response.summary.name)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          // The dialog closed while the request was in flight; there's no field left to show an
          // error in.
          return
        }

        setSubmitting(false)
        if (isFetchError(err) && err.status === 404) {
          setErrorText(t('lobbies.joinCode.notFound', 'That lobby is no longer open.'))
        } else {
          setErrorText(
            t('lobbies.joinCode.genericError', 'Something went wrong. Please try again.'),
          )
        }
      })
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={handleCancel} />,
    <TextButton
      label={t('lobbies.joinCode.submitAction', 'Find lobby')}
      key='submit'
      onClick={onSubmit}
      disabled={submitting}
      testName='join-code-submit-button'
    />,
  ]

  return (
    <Dialog
      title={t('lobbies.joinCode.title', 'Enter a join code')}
      buttons={buttons}
      onCancel={handleCancel}
      testName='join-code-dialog'>
      <Explainer>
        {t(
          'lobbies.joinCode.explainer',
          'Paste a lobby link, or enter the code shown when a link is opened in a browser.',
        )}
      </Explainer>
      <form noValidate={true} onSubmit={onSubmit}>
        <TextField
          value={value}
          onChange={event => {
            setValue(event.target.value)
            if (errorText) {
              setErrorText(undefined)
            }
          }}
          label={t('lobbies.joinCode.inputLabel', 'Code or lobby link')}
          floatingLabel={true}
          errorText={errorText}
          disabled={submitting}
          ref={inputRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}
          testName='join-code-input'
        />
      </form>
    </Dialog>
  )
}
