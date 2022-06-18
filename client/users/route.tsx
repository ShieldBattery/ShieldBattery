import React from 'react'
import { useRoute } from 'wouter'
import { makeSbUserId } from '../../common/users/sb-user'
import { replace } from '../navigation/routing'
import { ConnectedUserProfilePage } from './user-profile'
import { ALL_USER_PROFILE_SUB_PAGES, UserProfileSubPage } from './user-profile-sub-page'

export function ProfileRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute<{ userId: string; username: string; subPage?: string }>(
    '/users/:userId/:username/:subPage?',
  )

  if (!matches) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }
  const userIdNum = Number(params!.userId)
  if (isNaN(userIdNum)) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }

  const subPage = ALL_USER_PROFILE_SUB_PAGES.includes(params!.subPage as UserProfileSubPage)
    ? (params!.subPage as UserProfileSubPage)
    : undefined

  return (
    <ConnectedUserProfilePage
      userId={makeSbUserId(userIdNum)}
      username={params!.username}
      subPage={subPage}
    />
  )
}
