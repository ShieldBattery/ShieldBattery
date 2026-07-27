import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  ChannelPermissions,
  DetailedChannelInfo,
  fromUserChannelEntryJson,
  JoinedChannelInfo,
  SbChannelId,
  UserChannelEntry,
} from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'
import { useHasAnyPermission } from '../../admin/admin-permissions'
import { useSelfUser } from '../../auth/auth-utils'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { SubmitOnEnter } from '../../forms/submit-on-enter'
import { MaterialIcon } from '../../icons/material/material-icon'
import InfiniteScrollList from '../../lists/infinite-scroll-list'
import { IconButton, TextButton, useButtonState } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { CheckBox } from '../../material/check-box'
import { Dialog } from '../../material/dialog'
import { Ripple } from '../../material/ripple'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { ErrorText } from '../../settings/settings-content'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { labelMedium } from '../../styles/typography'
import { StaffBadgedAvatar } from '../../users/staff-badge'
import { listUserChannelEntries, updateChannelUserPermissions } from '../action-creators'
import {
  UserListCardActions,
  UserListCardInfo,
  UserListCardRow,
  UserListCardSubtitle,
  UserListCardUsername,
  userListDateFormat,
  UserListNoResults,
  UserListRoot,
  UserListSearchInput,
  UserListSearchResults,
  useSearchableUserList,
} from './user-list'

const UserCardButton = styled.button`
  ${buttonReset};

  position: relative;
  flex-grow: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  text-align: left;
`

const TransferOwnershipButton = styled(IconButton)`
  width: 36px;
  min-height: 36px;
`

const StyledAvatar = styled(StaffBadgedAvatar)`
  width: 40px;
  height: 40px;
`

const UsernameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const BadgesRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const Badge = styled.div<{ $variant: 'owner' | 'permission' }>`
  ${labelMedium};
  padding: 2px 8px;
  border-radius: 4px;
  background-color: ${props =>
    props.$variant === 'owner' ? 'var(--theme-amber)' : 'var(--theme-primary-container)'};
  color: ${props =>
    props.$variant === 'owner' ? 'var(--theme-on-amber)' : 'var(--theme-on-primary-container)'};
`

const PermissionsForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 0;
`

export function UserPermissionsSettings({
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  onCloseSettings,
}: {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const selfUser = useSelfUser()
  const isServerModerator = useHasAnyPermission('moderateChatChannels')
  const isChannelOwner = selfUser?.id === joinedChannelInfo.ownerId
  // Only the channel owner's authority allows editing another moderator's permissions. A delegated
  // moderator (granted `editPermissions` but not ownership) could otherwise use that same access to
  // rewrite a fellow moderator's permissions, laundering around the protections the server places on
  // moderation actions elsewhere (e.g. owners/moderators being unkickable/unbannable by other
  // moderators). Server moderators hold the owner's authority in every channel.
  const canEditModerators = isChannelOwner || isServerModerator
  // Handing the ownership over takes the owner's authority, which server moderators hold in every
  // channel. Official channels have no ownership to hand over.
  const canTransferOwnership = (isChannelOwner || isServerModerator) && !basicChannelInfo.official

  const {
    entries: channelUsers,
    setEntries: setChannelUsers,
    hasMore: hasMoreUsers,
    isLoadingMore: isLoadingMoreUsers,
    searchError,
    searchQuery,
    refreshToken,
    onSearchChange,
    onLoadMore: onLoadMoreUsers,
  } = useSearchableUserList<UserChannelEntry>({
    loadPage: ({ searchQuery: query, offset, signal, onSuccess, onError }) => {
      dispatch(
        listUserChannelEntries(basicChannelInfo.id, query, offset, {
          signal,
          onSuccess: data => {
            onSuccess({
              entries: data.userChannelEntries.map(fromUserChannelEntryJson),
              hasMore: data.hasMoreUsers,
            })
          },
          onError,
        }),
      )
    },
    getEntryKey: user => user.userId,
  })

  let searchContent
  if (searchError) {
    searchContent = (
      <UserListSearchResults>
        <ErrorText>
          {t('chat.channelSettings.permissions.loadError', 'Failed to load users.')}
        </ErrorText>
      </UserListSearchResults>
    )
  } else if (channelUsers?.length === 0) {
    searchContent = (
      <UserListSearchResults>
        <UserListNoResults>
          {searchQuery
            ? t('chat.channelSettings.permissions.noSearchResults', 'No users match your search')
            : t('chat.channelSettings.permissions.noUsers', 'This channel has no other members')}
        </UserListNoResults>
      </UserListSearchResults>
    )
  } else {
    const userItems = (channelUsers ?? []).map(user => {
      const isOwner = user.userId === joinedChannelInfo.ownerId
      const isModerator =
        user.channelPermissions.editPermissions ||
        user.channelPermissions.ban ||
        user.channelPermissions.kick
      // Editing your own permissions is always allowed by the server, even for a delegated moderator.
      const isSelf = user.userId === selfUser?.id
      const canEdit = !isOwner && (isSelf || canEditModerators || !isModerator)

      return (
        <UserChannelEntryRow
          key={user.userId}
          user={user}
          isOwner={isOwner}
          canEdit={canEdit}
          canTransferOwnership={canTransferOwnership && !isOwner}
          onTransferOwnershipClick={() =>
            dispatch(
              openDialog({
                type: DialogType.ChannelTransferOwnership,
                initData: {
                  channelId: basicChannelInfo.id,
                  channelName: basicChannelInfo.name,
                  userId: user.userId,
                  // Which user this screen marks as the owner comes from the channel info it was
                  // given, so it can't reflect the new owner on its own. Closing it keeps that from
                  // contradicting the reordered list, and an ex-owner holds no channel permissions
                  // to come back to anyway.
                  onSuccess: onCloseSettings,
                },
              }),
            )
          }
          onEditClick={() =>
            dispatch(
              openDialog({
                type: DialogType.ChannelUserPermissions,
                initData: {
                  channelId: user.channelId,
                  userId: user.userId,
                  permissions: user.channelPermissions,
                  onSuccess: (userId: SbUserId, newPermissions: ChannelPermissions) => {
                    setChannelUsers(prev =>
                      prev?.map(u =>
                        u.userId === userId ? { ...u, channelPermissions: newPermissions } : u,
                      ),
                    )
                  },
                },
              }),
            )
          }
        />
      )
    })

    searchContent = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreUsers}
        hasNextData={hasMoreUsers}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMoreUsers}>
        <UserListSearchResults>{userItems}</UserListSearchResults>
      </InfiniteScrollList>
    )
  }

  return (
    <UserListRoot>
      <UserListSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />

      {searchContent}
    </UserListRoot>
  )
}

function UserChannelEntryRow({
  user,
  isOwner,
  canEdit,
  canTransferOwnership,
  onEditClick,
  onTransferOwnershipClick,
}: {
  user: UserChannelEntry
  isOwner: boolean
  canEdit: boolean
  canTransferOwnership: boolean
  onEditClick: () => void
  onTransferOwnershipClick: () => void
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({
    disabled: !canEdit,
    onClick: onEditClick,
  })

  const transferOwnershipLabel = t(
    'chat.channelSettings.permissions.transferOwnership',
    'Transfer ownership',
  )

  return (
    <UserListCardRow>
      <UserCardButton {...buttonProps}>
        <StyledAvatar userId={user.userId} />

        <UserListCardInfo>
          <UsernameRow>
            <UserListCardUsername userId={user.userId} interactive={false} />
          </UsernameRow>
          <UserListCardSubtitle>
            {t('chat.channelSettings.permissions.joinedDate', 'Joined {{date}}', {
              date: userListDateFormat.format(user.joinDate),
            })}
          </UserListCardSubtitle>
          <PermissionBadges permissions={user.channelPermissions} isOwner={isOwner} />
        </UserListCardInfo>

        {canEdit && <Ripple ref={rippleRef} />}
      </UserCardButton>

      {canTransferOwnership ? (
        <UserListCardActions>
          <Tooltip text={transferOwnershipLabel} position='left'>
            <TransferOwnershipButton
              icon={<MaterialIcon icon='swap_horiz' size={20} />}
              ariaLabel={transferOwnershipLabel}
              onClick={onTransferOwnershipClick}
            />
          </Tooltip>
        </UserListCardActions>
      ) : null}
    </UserListCardRow>
  )
}

function PermissionBadges({
  permissions,
  isOwner,
}: {
  permissions: ChannelPermissions
  isOwner: boolean
}) {
  const { t } = useTranslation()

  const badges: Array<{ key: string; label: string }> = []

  if (isOwner) {
    badges.push({
      key: 'owner',
      label: t('chat.channelSettings.permissions.owner', 'Owner'),
    })
  } else {
    if (permissions.editPermissions) {
      badges.push({
        key: 'edit',
        label: t('chat.channelSettings.permissions.editPermissionsShort', 'Edit permissions'),
      })
    }
    if (permissions.togglePrivate) {
      badges.push({
        key: 'private',
        label: t('chat.channelSettings.permissions.togglePrivateShort', 'Toggle private'),
      })
    }
    if (permissions.ban) {
      badges.push({
        key: 'ban',
        label: t('chat.channelSettings.permissions.banShort', 'Ban'),
      })
    }
    if (permissions.kick) {
      badges.push({
        key: 'kick',
        label: t('chat.channelSettings.permissions.kickShort', 'Kick'),
      })
    }
    if (permissions.changeTopic) {
      badges.push({
        key: 'topic',
        label: t('chat.channelSettings.permissions.changeTopicShort', 'Change topic'),
      })
    }
  }

  if (badges.length === 0) {
    return null
  }

  return (
    <BadgesRow>
      {badges.map(badge => (
        <Badge key={badge.key} $variant={isOwner ? 'owner' : 'permission'}>
          {badge.label}
        </Badge>
      ))}
    </BadgesRow>
  )
}

export function ChannelUserPermissionsDialog({
  channelId,
  userId,
  permissions,
  onCancel,
  onSuccess,
}: {
  channelId: SbChannelId
  userId: SbUserId
  permissions: ChannelPermissions
  onCancel: () => void
  onSuccess: (userId: SbUserId, permissions: ChannelPermissions) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const userInfo = useAppSelector(s => s.users.byId.get(userId))

  const { submit, bindCheckable, form } = useForm<ChannelPermissions>(permissions, {})

  const [isSaving, setIsSaving] = useState(false)

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsSaving(true)

      dispatch(
        updateChannelUserPermissions(channelId, userId, model, {
          onSuccess: () => {
            setIsSaving(false)
            onCancel()
            onSuccess(userId, model)
          },
          onError: err => {
            setIsSaving(false)
            snackbarController.showSnackbar(
              t('chat.channelSettings.permissions.saveError', 'Failed to save permissions'),
            )
          },
        }),
      )
    },
  })

  const buttons = [
    <TextButton
      key='cancel'
      label={t('common.actions.cancel', 'Cancel')}
      onClick={onCancel}
      disabled={isSaving}
    />,
    <TextButton
      key='save'
      label={t('common.actions.save', 'Save')}
      onClick={submit}
      disabled={isSaving}
    />,
  ]

  return (
    <Dialog
      title={t('chat.channelSettings.permissions.editTitle', 'Edit permissions for {{name}}', {
        name: userInfo?.name ?? '...',
      })}
      onCancel={onCancel}
      buttons={buttons}>
      <PermissionsForm noValidate={true} onSubmit={submit}>
        <SubmitOnEnter disabled={isSaving} />
        <CheckBox
          {...bindCheckable('editPermissions')}
          label={t('chat.channelSettings.permissions.editPermissions', 'Can edit permissions')}
          disabled={selfUser?.id === userId || isSaving}
        />
        <CheckBox
          {...bindCheckable('togglePrivate')}
          label={t('chat.channelSettings.permissions.togglePrivate', 'Can toggle private status')}
          disabled={isSaving}
        />
        <CheckBox
          {...bindCheckable('ban')}
          label={t('chat.channelSettings.permissions.ban', 'Can ban users')}
          disabled={isSaving}
        />
        <CheckBox
          {...bindCheckable('kick')}
          label={t('chat.channelSettings.permissions.kick', 'Can kick users')}
          disabled={isSaving}
        />
        <CheckBox
          {...bindCheckable('changeTopic')}
          label={t('chat.channelSettings.permissions.changeTopic', 'Can change topic')}
          disabled={isSaving}
        />
      </PermissionsForm>
    </Dialog>
  )
}
