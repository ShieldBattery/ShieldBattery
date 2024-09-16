import React from 'react'
import { useRoute } from 'wouter'
import { makeSbUserId } from '../../common/users/sb-user.js'
import { replace } from '../navigation/routing.js'
import { ConnectedWhisper } from './whisper.js'

export function WhisperRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute<{ targetId: string; username: string }>(
    '/whispers/:targetId/:username',
  )

  if (!matches) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }
  const targetIdNum = Number(params!.targetId)
  if (isNaN(targetIdNum)) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }

  return <ConnectedWhisper userId={makeSbUserId(targetIdNum)} username={params!.username} />
}
