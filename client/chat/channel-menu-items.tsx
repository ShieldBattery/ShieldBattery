import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChannelModerationAction } from '../../common/chat'
import { appendToMultimap } from '../../common/data-structures/maps'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { DestructiveMenuItem } from '../material/menu/item'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { MenuItemCategory, UserMenuProps } from '../users/user-context-menu'
import { getChatUserProfile, moderateUser } from './action-creators'
import { ChannelContext } from './channel-context'

export function ChannelUserMenu({ userId, items, onMenuClose, MenuComponent }: UserMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
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
      // Channel owners always have these actions enabled and don't even have to wait for the
      // user's profile to be fully fetched to check their permissions.
      if (!isSelfChannelOwner && isSelfChannelModerator) {
        const canKick = channelSelfPermissions.editPermissions || channelSelfPermissions.kick
        kickDisabled = !canKick || !channelUserProfile || channelUserProfile.isModerator

        const canBan = channelSelfPermissions.editPermissions || channelSelfPermissions.ban
        banDisabled = !canBan || !channelUserProfile || channelUserProfile.isModerator
      }

      if (isSelfChannelOwner || isSelfChannelModerator) {
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
