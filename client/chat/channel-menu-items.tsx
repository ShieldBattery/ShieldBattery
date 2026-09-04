import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { appendToMultimap } from '../../common/data-structures/maps'
import { getErrorStack } from '../../common/errors'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import logger from '../logging/logger'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import {
  MenuItemCategory as MessageMenuItemCategory,
  MessageMenuProps,
} from '../messaging/message-context-menu'
import { getServerOrigin } from '../network/server-url'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { MenuItemCategory, UserMenuProps } from '../users/user-context-menu'
import { getChatUserProfile } from './action-creators'
import { ChannelContext } from './channel-context'
import { urlForChannelMessage } from './channel-url'

export function ChannelUserMenu({ userId, items, onMenuClose, MenuComponent }: UserMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUserId = useAppSelector(s => s.auth.self!.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const { channelId } = useContext(ChannelContext)
  const isServerModerator = useHasAnyPermission('moderateChatChannels')
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

  const menuItems = new Map(items)
  if (user && joinedChannelInfo && channelSelfPermissions) {
    if (user.id !== selfUserId) {
      const channelUserProfile = channelUserProfiles?.get(user.id)

      const isSelfChannelOwner = joinedChannelInfo.ownerId === selfUserId
      const isSelfChannelModerator =
        channelSelfPermissions.editPermissions ||
        channelSelfPermissions.kick ||
        channelSelfPermissions.ban

      let kickDisabled = false
      let banDisabled = false
      // Server moderators and channel owners always have these actions enabled and don't even have
      // to wait for the user's profile to be fully fetched to check their permissions.
      if (!isSelfChannelOwner && !isServerModerator && isSelfChannelModerator) {
        const canKick = channelSelfPermissions.editPermissions || channelSelfPermissions.kick
        kickDisabled = !canKick || !channelUserProfile || channelUserProfile.isModerator

        const canBan = channelSelfPermissions.editPermissions || channelSelfPermissions.ban
        banDisabled = !canBan || !channelUserProfile || channelUserProfile.isModerator
      }

      if (isSelfChannelOwner || isServerModerator || isSelfChannelModerator) {
        appendToMultimap(
          menuItems,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem
            key='kick'
            text={t('chat.channelMenu.kickAction', {
              defaultValue: 'Kick {{user}}',
              user: user.name,
            })}
            disabled={kickDisabled}
            onClick={() => {
              if (!user) {
                return
              }

              dispatch(
                openDialog({
                  type: DialogType.ChannelKickUserConfirmation,
                  initData: { channelId, userId: user.id },
                }),
              )
              onMenuClose()
            }}
          />,
        )
        appendToMultimap(
          menuItems,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem
            key='ban'
            text={t('chat.channelMenu.banAction', {
              defaultValue: 'Ban {{user}}',
              user: user.name,
            })}
            disabled={banDisabled}
            onClick={() => {
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
            }}
          />,
        )
      }
    }
  }

  return <MenuComponent items={menuItems} userId={userId} onMenuClose={onMenuClose} />
}

export function ChannelMessageMenu({
  messageId,
  items,
  onMenuClose,
  MenuComponent,
}: MessageMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { channelId } = useContext(ChannelContext)
  const channelName = useAppSelector(s => s.chat.idToBasicInfo.get(channelId)?.name)
  const isServerModerator = useHasAnyPermission('moderateChatChannels')

  const menuItems = new Map(items)
  appendToMultimap(
    menuItems,
    MessageMenuItemCategory.General,
    <MenuItem
      key='copy-message-link'
      text={t('chat.messageMenu.copyMessageLink', 'Copy message link')}
      onClick={() => {
        navigator.clipboard
          .writeText(getServerOrigin() + urlForChannelMessage(channelId, channelName, messageId))
          .catch(err => logger.error(`Error writing to clipboard: ${getErrorStack(err)}`))
        onMenuClose()
      }}
    />,
  )

  if (isServerModerator) {
    appendToMultimap(
      menuItems,
      MessageMenuItemCategory.Destructive,
      <DestructiveMenuItem
        key='delete-message'
        text={t('chat.messageMenu.deleteMessage', 'Delete message')}
        onClick={() => {
          dispatch(
            openDialog({
              type: DialogType.AdminDeleteChatMessage,
              initData: { channelId, messageId },
            }),
          )
          onMenuClose()
        }}
      />,
    )
  }

  return <MenuComponent items={menuItems} messageId={messageId} onMenuClose={onMenuClose} />
}
