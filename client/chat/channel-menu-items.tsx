import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChannelModerationAction, SbChannelId } from '../../common/chat.js'
import { appendToMultimap } from '../../common/data-structures/maps.js'
import { CAN_LEAVE_SHIELDBATTERY_CHANNEL } from '../../common/flags.js'
import { SbUserId } from '../../common/users/sb-user.js'
import { useSelfPermissions } from '../auth/auth-utils.js'
import { openDialog } from '../dialogs/action-creators.js'
import { DialogType } from '../dialogs/dialog-type.js'
import { DestructiveMenuItem } from '../material/menu/item.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { openSnackbar } from '../snackbars/action-creators.js'
import { useStableCallback } from '../state-hooks.js'
import { MenuItemCategory } from '../users/user-context-menu.js'
import { deleteMessageAsAdmin, getChatUserProfile, moderateUser } from './action-creators.js'

// NOTE(2Pac): Even though this function is technically not a React component, nor a custom hook, we
// still treat it as one since it suits our needs quite nicely (by allowing us to run hooks in it
// only when the user context menu is open).
/**
 * A function which adds user context menu items specific to chat channels (e.g. kick/ban user from
 * a chat channel).
 */
export function addChannelUserMenuItems(
  userId: SbUserId,
  items: Map<MenuItemCategory, React.ReactNode[]>,
  onMenuClose: (event?: MouseEvent) => void,
  channelId: SbChannelId,
) {
  /* eslint-disable react-hooks/rules-of-hooks */
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfPermissions = useSelfPermissions()
  const selfUserId = useAppSelector(s => s.auth.self!.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))
  const channelUserProfiles = useAppSelector(s => s.chat.idToUserProfiles.get(channelId))
  const channelSelfPermissions = useAppSelector(s => s.chat.idToSelfPermissions.get(channelId))

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
    if (!user) {
      return
    }

    dispatch(
      moderateUser(channelId, user.id, ChannelModerationAction.Kick, {
        onSuccess: () =>
          dispatch(
            openSnackbar({
              message: t('chat.channelMenu.userKicked', {
                defaultValue: '{{user}} was kicked',
                user: user.name,
              }),
            }),
          ),
        onError: () =>
          dispatch(
            openSnackbar({
              message: t('chat.channelMenu.kickingError', {
                defaultValue: 'Error kicking {{user.name}}',
                user: user.name,
              }),
            }),
          ),
      }),
    )
    onMenuClose()
  })

  const onBanUser = useStableCallback(() => {
    if (!user) {
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

  if (!user || !joinedChannelInfo || !channelUserProfiles || !channelSelfPermissions) {
    return items
  }

  const channelUserProfile = channelUserProfiles.get(user.id)
  if (
    channelUserProfile &&
    user.id !== selfUserId &&
    (channelId !== 1 || CAN_LEAVE_SHIELDBATTERY_CHANNEL)
  ) {
    if (
      selfPermissions?.editPermissions ||
      selfPermissions?.moderateChatChannels ||
      joinedChannelInfo.ownerId === selfUserId
    ) {
      appendToMultimap(
        items,
        MenuItemCategory.Destructive,
        <DestructiveMenuItem
          key='kick'
          text={t('chat.channelMenu.kickAction', {
            defaultValue: 'Kick {{user}}',
            user: user.name,
          })}
          onClick={onKickUser}
        />,
      )
      appendToMultimap(
        items,
        MenuItemCategory.Destructive,
        <DestructiveMenuItem
          key='ban'
          text={t('chat.channelMenu.banAction', {
            defaultValue: 'Ban {{user}}',
            user: user.name,
          })}
          onClick={onBanUser}
        />,
      )
    } else if (!channelUserProfile.isModerator) {
      if (channelSelfPermissions.kick) {
        appendToMultimap(
          items,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem
            key='kick'
            text={t('chat.channelMenu.kickAction', {
              defaultValue: 'Kick {{user}}',
              user: user.name,
            })}
            onClick={onKickUser}
          />,
        )
      }
      if (channelSelfPermissions.ban) {
        appendToMultimap(
          items,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem
            key='ban'
            text={t('chat.channelMenu.banAction', {
              defaultValue: 'Ban {{user}}',
              user: user.name,
            })}
            onClick={onBanUser}
          />,
        )
      }
    }
  }

  return items
}

// NOTE(2Pac): Even though this function is technically not a React component, nor a custom hook, we
// still treat it as one since it suits our needs quite nicely (by allowing us to run hooks in it
// only when the message context menu is open).
/**
 * A function which adds message context menu items specific to chat channels (e.g. delete message
 * from a chat channel).
 */
export function addChannelMessageMenuItems(
  messageId: string,
  items: React.ReactNode[],
  onMenuClose: (event?: MouseEvent) => void,
  channelId: SbChannelId,
) {
  /* eslint-disable react-hooks/rules-of-hooks */
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfPermissions = useSelfPermissions()
  /* eslint-enable react-hooks/rules-of-hooks */

  if (selfPermissions?.moderateChatChannels) {
    items.push(
      <DestructiveMenuItem
        key='delete-message'
        text='Delete message'
        onClick={() => {
          dispatch(
            deleteMessageAsAdmin(channelId, messageId, {
              onSuccess: () => {
                dispatch(
                  openSnackbar({
                    message: t('chat.messageMenu.messageDeleted', 'Message deleted'),
                  }),
                )
              },
              onError: () => {
                dispatch(
                  openSnackbar({
                    message: t('chat.messageMenu.deleteError', 'Error deleting message'),
                  }),
                )
              },
            }),
          )
          onMenuClose()
        }}
      />,
    )
  }

  return items
}
