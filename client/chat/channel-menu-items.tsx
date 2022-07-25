import React, { useEffect } from 'react'
import styled from 'styled-components'
import { ChannelModerationAction, SbChannelId } from '../../common/chat'
import { appendToMultimap } from '../../common/data-structures/maps'
import { MULTI_CHANNEL } from '../../common/flags'
import { SbUserId } from '../../common/users/sb-user'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MenuItem } from '../material/menu/item'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { colorError } from '../styles/colors'
import { MenuItemCategory } from '../users/user-context-menu'
import { getChatUserProfile, moderateUser } from './action-creators'

const DestructiveMenuItem = styled(MenuItem)`
  color: ${colorError};

  --sb-ripple-color: ${colorError};
`

// NOTE(2Pac): Even though this function is technically not a React component, nor a custom hook, we
// still treat it as one since it suits our needs quite nicely (by allowing us to run hooks in it
// only when the user context menu is open).
/**
 * A function which adds user context menu items specific to chat channels (e.g. kick/ban user from
 * a chat channel).
 */
export const addChannelMenuItems = (
  userId: SbUserId,
  items: Map<MenuItemCategory, React.ReactNode[]>,
  onMenuClose: (event?: MouseEvent) => void,
  channelId: SbChannelId,
) => {
  /* eslint-disable react-hooks/rules-of-hooks */
  const dispatch = useAppDispatch()
  const selfPermissions = useAppSelector(s => s.auth.permissions)
  const selfUserId = useAppSelector(s => s.auth.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const channel = useAppSelector(s => s.chat.byId.get(channelId))

  useEffect(() => {
    const abortController = new AbortController()

    dispatch(
      getChatUserProfile(channelId, userId, {
        signal: abortController.signal,
        onSuccess: () => {},
        onError: () => {},
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [dispatch, channelId, userId])

  const onKickUser = useStableCallback(() => {
    if (!user || !channel) {
      return
    }

    dispatch(
      moderateUser(channelId, user.id, ChannelModerationAction.Kick, {
        onSuccess: () => dispatch(openSnackbar({ message: `${user.name} was kicked` })),
        onError: () => dispatch(openSnackbar({ message: `Error kicking ${user.name}` })),
      }),
    )
    onMenuClose()
  })

  const onBanUser = useStableCallback(() => {
    if (!user || !channel) {
      return
    }

    dispatch(
      openDialog({
        type: DialogType.ChannelBanUser,
        initData: { channelId, userId },
      }),
    )
    onMenuClose()
  })
  /* eslint-enable react-hooks/rules-of-hooks */

  if (!user || !channel) {
    return items
  }

  const channelUserProfile = channel.userProfiles.get(user.id)
  if (MULTI_CHANNEL && channelUserProfile && user.id !== selfUserId && channelId !== 1) {
    if (
      selfPermissions.editPermissions ||
      selfPermissions.moderateChatChannels ||
      channel.ownerId === selfUserId
    ) {
      appendToMultimap(
        items,
        MenuItemCategory.Destructive,
        <DestructiveMenuItem key='kick' text={`Kick ${user.name}`} onClick={onKickUser} />,
      )
      appendToMultimap(
        items,
        MenuItemCategory.Destructive,
        <DestructiveMenuItem key='ban' text={`Ban ${user.name}`} onClick={onBanUser} />,
      )
    } else if (!channelUserProfile.isModerator) {
      if (channel?.selfPermissions?.kick) {
        appendToMultimap(
          items,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem key='kick' text={`Kick ${user.name}`} onClick={onKickUser} />,
        )
      }
      if (channel?.selfPermissions?.ban) {
        appendToMultimap(
          items,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem key='ban' text={`Ban ${user.name}`} onClick={onBanUser} />,
        )
      }
    }
  }

  return items
}
