import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChannelModerationAction } from '../../common/chat'
import { appendToMultimap } from '../../common/data-structures/maps'
import { useSelfPermissions } from '../auth/auth-utils'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { DestructiveMenuItem } from '../material/menu/item'
import { MessageMenuProps } from '../messaging/message-context-menu'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { MenuItemCategory, UserMenuProps } from '../users/user-context-menu'
import { deleteMessageAsAdmin, getChatUserProfile, moderateUser } from './action-creators'
import { ChannelContext } from './channel-context'

export function ChannelUserMenu({ userId, items, onMenuClose, MenuComponent }: UserMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfPermissions = useSelfPermissions()
  const selfUserId = useAppSelector(s => s.auth.self!.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const { channelId } = useContext(ChannelContext)
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
  if (user && selfPermissions && joinedChannelInfo && channelSelfPermissions) {
    if (user.id !== selfUserId) {
      const channelUserProfile = channelUserProfiles?.get(user.id)

      const isSelfServerModerator =
        selfPermissions.editPermissions || selfPermissions.moderateChatChannels
      const isSelfChannelOwner = joinedChannelInfo.ownerId === selfUserId
      const isSelfChannelModerator =
        channelSelfPermissions.editPermissions ||
        channelSelfPermissions.kick ||
        channelSelfPermissions.ban

      let disabled = false
      // Server moderators and channel owners always have these actions enabled and don't even have
      // to wait for the user's profile to be fully fetched to check their permissions.
      if (!isSelfServerModerator && !isSelfChannelOwner && isSelfChannelModerator) {
        disabled = !channelUserProfile || channelUserProfile.isModerator
      }

      if (isSelfServerModerator || isSelfChannelOwner || isSelfChannelModerator) {
        appendToMultimap(
          menuItems,
          MenuItemCategory.Destructive,
          <DestructiveMenuItem
            key='kick'
            text={t('chat.channelMenu.kickAction', {
              defaultValue: 'Kick {{user}}',
              user: user.name,
            })}
            disabled={disabled}
            onClick={() => {
              if (!user) {
                return
              }

              dispatch(
                moderateUser(channelId, user.id, ChannelModerationAction.Kick, {
                  onSuccess: () =>
                    snackbarController.showSnackbar(
                      t('chat.channelMenu.userKicked', {
                        defaultValue: '{{user}} was kicked',
                        user: user.name,
                      }),
                    ),
                  onError: () =>
                    snackbarController.showSnackbar(
                      t('chat.channelMenu.kickingError', {
                        defaultValue: 'Error kicking {{user.name}}',
                        user: user.name,
                      }),
                    ),
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
            disabled={disabled}
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
  const snackbarController = useSnackbarController()
  const selfPermissions = useSelfPermissions()
  const { channelId } = useContext(ChannelContext)

  const menuItems = new Map(items)
  if (selfPermissions?.moderateChatChannels) {
    appendToMultimap(
      menuItems,
      MenuItemCategory.Destructive,
      <DestructiveMenuItem
        key='delete-message'
        text='Delete message'
        onClick={() => {
          dispatch(
            deleteMessageAsAdmin(channelId, messageId, {
              onSuccess: () => {
                snackbarController.showSnackbar(
                  t('chat.messageMenu.messageDeleted', 'Message deleted'),
                )
              },
              onError: () => {
                snackbarController.showSnackbar(
                  t('chat.messageMenu.deleteError', 'Error deleting message'),
                )
              },
            }),
          )
          onMenuClose()
        }}
      />,
    )
  }

  return <MenuComponent items={menuItems} messageId={messageId} onMenuClose={onMenuClose} />
}
