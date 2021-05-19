import React, { useCallback } from 'react'
import MenuItem from '../material/menu/item'
import { useAppSelector } from '../redux-hooks'
import { navigateToWhisper } from '../whispers/action-creators'
import { UserProfileOverlay, UserProfileOverlayProps } from './user-profile-overlay'

export function ConnectedUserProfileOverlay(props: Omit<UserProfileOverlayProps, 'children'>) {
  const selfUser = useAppSelector(s => s.auth.user)

  const { username } = props

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(username)
  }, [username])

  const actions = []
  if (username !== selfUser.name) {
    actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)
  }

  return <UserProfileOverlay {...props}>{actions}</UserProfileOverlay>
}
