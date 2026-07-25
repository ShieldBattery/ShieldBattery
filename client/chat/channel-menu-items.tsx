import { useContext, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { appendToMultimap } from '../../common/data-structures/maps'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { DestructiveMenuItem } from '../material/menu/item'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { MenuItemCategory, UserMenuProps } from '../users/user-context-menu'
import { getChatUserProfile } from './action-creators'
import { ChannelContext } from './channel-context'

export function ChannelUserMenu({ userId, items, onMenuClose, MenuComponent }: UserMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUserId = useAppSelector(s => s.auth.self!.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const { channelId } = useContext(ChannelContext)
  const isServerModerator = useHasAnyPermission('moderateChatChannels')
  const isOfficialChannel = useAppSelector(s => s.chat.idToBasicInfo.get(channelId)?.official)
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId))
  const channelUserProfiles = useAppSelector(s => s.chat.idToUserProfiles.get(channelId))
  const channelSelfPermissions = useAppSelector(s => s.chat.idToSelfPermissions.get(channelId))
  // Official channels have no owner, so server moderators hold the owner's authority in them.
  const hasOfficialChannelAuthority = isServerModerator && !!isOfficialChannel

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
      // Users with the channel owner's authority always have these actions enabled and don't even
      // have to wait for the user's profile to be fully fetched to check their permissions.
      if (!isSelfChannelOwner && !hasOfficialChannelAuthority && isSelfChannelModerator) {
        const canKick = channelSelfPermissions.editPermissions || channelSelfPermissions.kick
        kickDisabled = !canKick || !channelUserProfile || channelUserProfile.isModerator

        const canBan = channelSelfPermissions.editPermissions || channelSelfPermissions.ban
        banDisabled = !canBan || !channelUserProfile || channelUserProfile.isModerator
      }

      if (isSelfChannelOwner || hasOfficialChannelAuthority || isSelfChannelModerator) {
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
