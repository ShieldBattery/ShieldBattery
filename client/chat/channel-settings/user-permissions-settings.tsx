import { debounce } from 'lodash-es'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  ChannelPermissions,
  DetailedChannelInfo,
  fromUserChannelEntryJson,
  JoinedChannelInfo,
  UserChannelEntry,
} from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'
import { useSelfUser } from '../../auth/auth-utils'
import { ConnectedAvatar } from '../../avatars/avatar'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { SubmitOnEnter } from '../../forms/submit-on-enter'
import InfiniteScrollList from '../../lists/infinite-scroll-list'
import { TextButton, useButtonState } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { CheckBox } from '../../material/check-box'
import { Dialog } from '../../material/dialog'
import { Ripple } from '../../material/ripple'
import { elevationPlus1 } from '../../material/shadows'
import { useRefreshToken } from '../../network/refresh-token'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { SearchInput } from '../../search/search-input'
import { ErrorText } from '../../settings/settings-content'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { ContainerLevel, containerStyles } from '../../styles/colors'
import { bodyLarge, labelMedium, singleLine, titleSmall } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { listUserChannelEntries, updateChannelUserPermissions } from '../action-creators'

const joinDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SearchResults = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const NoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

const StyledSearchInput = styled(SearchInput)`
  width: 256px;
`

const UserCardButton = styled.button`
  ${buttonReset};
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};

  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-radius: 4px;
  text-align: left;
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
`

const UserInfoContainer = styled.div`
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const UsernameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const StyledUsername = styled(ConnectedUsername)`
  ${titleSmall};
  ${singleLine};
`

const JoinDateText = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
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
}: {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [channelUsers, setChannelUsers] = useState<UserChannelEntry[]>()
  const [hasMoreUsers, setHasMoreUsers] = useState(true)

  const [isLoadingMoreUsers, setIsLoadingMoreUsers] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useState('')
  const abortControllerRef = useRef<AbortController>(undefined)

  const [refreshToken, triggerRefresh] = useRefreshToken()
  const debouncedSearchRef = useRef(
    debounce((query: string) => {
      // Just need to clear the search results here and let the infinite scroll list initiate the
      // network request.
      setSearchQuery(query)
      // TODO(2Pac): Make the infinite scroll lost in charge of the loading state, so we don't have
      // to do this here, which is pretty unintuitive.
      setIsLoadingMoreUsers(false)
      setSearchError(undefined)
      setChannelUsers(undefined)
      setHasMoreUsers(true)
      triggerRefresh()
    }, 100),
  )

  const onSearchChange = (query: string) => {
    debouncedSearchRef.current(query)
  }

  const onLoadMoreUsers = () => {
    setIsLoadingMoreUsers(true)
    setSearchError(undefined)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      listUserChannelEntries(basicChannelInfo.id, searchQuery, channelUsers?.length ?? 0, {
        signal: abortControllerRef.current.signal,
        onSuccess: data => {
          setIsLoadingMoreUsers(false)
          setChannelUsers(prev =>
            (prev ?? []).concat(data.userChannelEntries.map(fromUserChannelEntryJson)),
          )
          setHasMoreUsers(data.hasMoreUsers)
        },
        onError: err => {
          setIsLoadingMoreUsers(false)
          setSearchError(err)
        },
      }),
    )
  }

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  let searchContent
  if (searchError) {
    searchContent = (
      <SearchResults>
        <ErrorText>
          {t('chat.channelSettings.permissions.loadError', 'Failed to load users.')}
        </ErrorText>
      </SearchResults>
    )
  } else if (channelUsers?.length === 0) {
    searchContent = (
      <SearchResults>
        <NoResults>
          {t('chat.channelSettings.permissions.noUsers', 'This channel has no other members')}
        </NoResults>
      </SearchResults>
    )
  } else {
    const userItems = (channelUsers ?? []).map(user => (
      <UserChannelEntryRow
        key={user.userId}
        user={user}
        isOwner={user.userId === joinedChannelInfo.ownerId}
        onEditClick={() =>
          dispatch(
            openDialog({
              type: DialogType.ChannelUserPermissions,
              initData: {
                userChannelEntry: user,
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
    ))

    searchContent = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreUsers}
        hasNextData={hasMoreUsers}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMoreUsers}>
        <SearchResults>{userItems}</SearchResults>
      </InfiniteScrollList>
    )
  }

  return (
    <Container>
      <StyledSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />

      {searchContent}
    </Container>
  )
}

function UserChannelEntryRow({
  user,
  isOwner,
  onEditClick,
}: {
  user: UserChannelEntry
  isOwner: boolean
  onEditClick: () => void
}) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({
    disabled: isOwner,
    onClick: onEditClick,
  })

  return (
    <UserCardButton {...buttonProps}>
      <StyledAvatar userId={user.userId} />

      <UserInfoContainer>
        <UsernameRow>
          <StyledUsername userId={user.userId} interactive={false} />
        </UsernameRow>
        <JoinDateText>
          {t('chat.channelSettings.permissions.joinedDate', 'Joined {{date}}', {
            date: joinDateFormat.format(user.joinDate),
          })}
        </JoinDateText>
        <PermissionBadges permissions={user.channelPermissions} isOwner={isOwner} />
      </UserInfoContainer>

      {!isOwner && <Ripple ref={rippleRef} />}
    </UserCardButton>
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
  userChannelEntry,
  onCancel,
  onSuccess,
}: {
  userChannelEntry: UserChannelEntry
  onCancel: () => void
  onSuccess: (userId: SbUserId, permissions: ChannelPermissions) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const userInfo = useAppSelector(s => s.users.byId.get(userChannelEntry.userId))

  const { submit, bindCheckable, form } = useForm<ChannelPermissions>(
    userChannelEntry.channelPermissions,
    {},
  )

  const [isSaving, setIsSaving] = useState(false)

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsSaving(true)

      dispatch(
        updateChannelUserPermissions(userChannelEntry.channelId, userChannelEntry.userId, model, {
          onSuccess: () => {
            setIsSaving(false)
            onCancel()
            onSuccess(userChannelEntry.userId, model)
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
          disabled={selfUser?.id === userChannelEntry.userId || isSaving}
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
