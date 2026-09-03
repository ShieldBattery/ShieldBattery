import { useEffect, useEffectEvent } from 'react'
import { isMessageLinkId } from '../messaging/message-link'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useOpenWhisperMessageLink } from './open-whisper-message-link'

/**
 * Resolves a viewer-independent whisper message link (`/whispers/m/<id>`) to the conversation it
 * belongs to, from the current user's side, and redirects there. A `replace` rather than a `push`
 * is used throughout: the unresolved link is a waypoint, not a page worth keeping in history. On
 * failure there's no "where the user was" to fall back to (they arrived here directly, e.g. by
 * typing the URL or opening it in a new window), so this falls back to home instead -- unlike the
 * message-link chip, which stays put and leaves a snackbar.
 */
export function WhisperMessageLinkRedirect({ messageId }: { messageId: string }) {
  const openWhisperMessageLink = useOpenWhisperMessageLink()

  const onResolve = useEffectEvent((id: string, signal: AbortSignal) => {
    openWhisperMessageLink(id, {
      transitionFn: replace,
      signal,
      onError: () => replace('/'),
    })
  })

  useEffect(() => {
    if (!isMessageLinkId(messageId)) {
      replace('/')
      return undefined
    }

    const abortController = new AbortController()
    onResolve(messageId, abortController.signal)

    return () => {
      abortController.abort()
    }
  }, [messageId])

  return <LoadingDotsArea />
}
