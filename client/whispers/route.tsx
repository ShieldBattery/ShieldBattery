import { useRoute } from 'wouter'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { replace } from '../navigation/routing'
import { ConnectedWhisper } from './whisper'

export function WhisperRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute<{ targetId: string; username: string }>(
    '/whispers/:targetId/:username',
  )

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
