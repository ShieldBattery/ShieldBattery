import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useRoute } from 'wouter'
import { ChannelModerationAction } from '../../common/chat'
import { MULTI_CHANNEL } from '../../common/flags'
import { SbUserId } from '../../common/users/sb-user'
import { useSelfUser } from '../auth/state-hooks'
import { getChatUserProfile, moderateUser } from '../chat/action-creators'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { Menu } from '../material/menu/menu'
import { PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { colorTextFaint } from '../styles/colors'
import { subtitle1 } from '../styles/typography'
import { navigateToWhisper } from '../whispers/action-creators'
import { navigateToUserProfile } from './action-creators'

const LoadingItem = styled(MenuItem)`
  color: ${colorTextFaint};
`

const LoadingError = styled.div`
  ${subtitle1};
  padding: 16px;
`

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserContextMenu({ userId, popoverProps }: ConnectedUserContextMenuProps) {
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const cancelLoadRef = useRef(new AbortController())
  const [loadingChatUserProfileError, setLoadingChatUserProfileError] = useState<Error>()
  const selfPermissions = useAppSelector(s => s.auth.permissions)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const [, routeParams] = useRoute('/chat/:channelName')
  const channelName = routeParams?.channelName.toLowerCase()
  const chatUserProfile = useAppSelector(s => {
    const channel = channelName ? s.chat.byName.get(channelName) : undefined
    return channel?.userProfiles.get(userId)
  })
  const chatSelfPermissions = useAppSelector(s => {
    const channel = channelName ? s.chat.byName.get(channelName) : undefined
    return channel?.selfPermissions
  })

  const partyId = useAppSelector(s => s.party.current?.id)
  const partyMembers = useAppSelector(s => s.party.current?.members)
  const partyInvites = useAppSelector(s => s.party.current?.invites)
  const partyLeader = useAppSelector(s => s.party.current?.leader)

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    if (popoverProps.open && channelName) {
      dispatch(
        getChatUserProfile(channelName, userId, {
          signal: abortController.signal,
          onSuccess: () => setLoadingChatUserProfileError(undefined),
          onError: err => setLoadingChatUserProfileError(err),
        }),
      )
    }

    return () => {
      abortController.abort()
    }
  }, [dispatch, popoverProps, channelName, userId])

  const onPopoverDismiss = popoverProps.onDismiss

  const onViewProfileClick = useCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  }, [user])

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  const onInviteToPartyClick = useCallback(() => {
    dispatch(inviteToParty({ targetId: userId }))
    onPopoverDismiss()
  }, [userId, dispatch, onPopoverDismiss])

  const onRemovePartyInvite = useCallback(() => {
    dispatch(removePartyInvite(partyId!, userId))
    onPopoverDismiss()
  }, [partyId, userId, dispatch, onPopoverDismiss])

  const onKickPlayerClick = useCallback(() => {
    dispatch(kickPlayer(partyId!, userId))
    onPopoverDismiss()
  }, [partyId, userId, dispatch, onPopoverDismiss])

  const onKickUser = useCallback(() => {
    if (!channelName || !user) {
      return
    }

    dispatch(
      moderateUser(channelName, user.id, ChannelModerationAction.Kick, {
        onSuccess: () => dispatch(openSnackbar({ message: `${user.name} was kicked` })),
        onError: () => dispatch(openSnackbar({ message: `Error kicking ${user.name}` })),
      }),
    )
    onPopoverDismiss()
  }, [user, channelName, dispatch, onPopoverDismiss])

  const onBanUser = useCallback(() => {
    if (!channelName || !user) {
      return
    }

    dispatch(openDialog(DialogType.ChannelBanUser, { channel: channelName, user }))
    onPopoverDismiss()
  }, [user, channelName, dispatch, onPopoverDismiss])

  const actions: React.ReactNode[] = []
  if (!user || !chatUserProfile || !chatSelfPermissions) {
    // TODO(tec27): Ideally this wouldn't have hover/focus state
    actions.push(<LoadingItem key='loading' text='Loading user…' />)
  } else {
    actions.push(<MenuItem key='profile' text='View profile' onClick={onViewProfileClick} />)

    if (user.id !== selfUser.id) {
      actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)

      if (IS_ELECTRON) {
        if (!partyId) {
          actions.push(
            <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
          )
        } else if (partyLeader === selfUser.id) {
          const isAlreadyInParty = !!partyMembers?.includes(user.id)
          const hasInvite = !!partyInvites?.includes(user.id)
          if (isAlreadyInParty) {
            actions.push(
              <MenuItem key='kick-party' text='Kick from party' onClick={onKickPlayerClick} />,
            )
          } else if (hasInvite) {
            actions.push(
              <MenuItem key='invite' text='Uninvite from party' onClick={onRemovePartyInvite} />,
            )
          } else {
            actions.push(
              <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
            )
          }
        }
      }

      if (MULTI_CHANNEL && channelName && channelName.toLowerCase() !== 'shieldbattery') {
        if (selfPermissions.moderateChatChannels || chatSelfPermissions.owner) {
          actions.push(
            <Divider key='moderation-divider' />,
            <MenuItem key='kick' text={`Kick ${user.name}`} onClick={onKickUser} />,
            <MenuItem key='ban' text={`Ban ${user.name}`} onClick={onBanUser} />,
          )
        } else if (!chatUserProfile.isModerator) {
          if (chatSelfPermissions.kick || chatSelfPermissions.ban) {
            actions.push(<Divider key='moderation-divider' />)
          }
          if (chatSelfPermissions.kick) {
            actions.push(<MenuItem key='kick' text={`Kick ${user.name}`} onClick={onKickUser} />)
          }
          if (chatSelfPermissions.ban) {
            actions.push(<MenuItem key='ban' text={`Ban ${user.name}`} onClick={onBanUser} />)
          }
        }
      }
    }
  }

  return (
    <Menu dense={true} {...popoverProps}>
      {loadingChatUserProfileError ? (
        <LoadingError>There was a problem loading this user.</LoadingError>
      ) : (
        actions
      )}
    </Menu>
  )
}
