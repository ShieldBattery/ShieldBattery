import { useRoute } from 'wouter'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { useRequireLogin } from '../auth/auth-utils'
import { replace } from '../navigation/routing'
import { ConnectedWhisper } from './whisper'
import { WhisperMessageLinkRedirect } from './whisper-message-link-redirect'

export function WhisperRouteComponent(props: { params: any }) {
  const [matchesMessageLink, messageLinkParams] = useRoute<{ messageId: string }>(
    '/whispers/m/:messageId',
  )
  const [matches, params] = useRoute<{ targetId: string; username: string }>(
    '/whispers/:targetId/:username',
  )

  const isRedirecting = useRequireLogin()

  if (isRedirecting) {
    return null
  }

  if (matchesMessageLink) {
    // Checked ahead of the generic route below: a message link's URL also matches
    // `/whispers/:targetId/:username` (with the message-link segment read as the target id), and
    // that route would just bounce to `/` on it (`Number('m')` is NaN).
    return <WhisperMessageLinkRedirect messageId={messageLinkParams!.messageId} />
  }

  if (!matches) {
    return null
  }
  const targetIdNum = Number(params!.targetId)
  if (isNaN(targetIdNum)) {
    replace('/')
    return null
  }

  return <ConnectedWhisper targetId={makeSbUserId(targetIdNum)} targetUsername={params!.username} />
}
