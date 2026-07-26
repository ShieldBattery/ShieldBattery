import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  ChannelBanEntry,
  DetailedChannelInfo,
  fromChannelBanEntryJson,
  JoinedChannelInfo,
  SbChannelId,
} from '../../../common/chat'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import InfiniteScrollList from '../../lists/infinite-scroll-list'
import { TextButton } from '../../material/button'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { ErrorText } from '../../settings/settings-content'
import { labelMedium } from '../../styles/typography'
import { listChannelBans } from '../action-creators'
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

const UserCardContent = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  text-align: left;
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
`

const Badge = styled.div`
  ${labelMedium};
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: var(--theme-primary-container);
  color: var(--theme-on-primary-container);
`

export function BannedUsersSettings({
  basicChannelInfo,
}: {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const {
    entries: bannedUsers,
    setEntries: setBannedUsers,
    hasMore: hasMoreBans,
    isLoadingMore: isLoadingMoreBans,
    searchError,
    searchQuery,
    refreshToken,
    onSearchChange,
    onLoadMore: onLoadMoreBans,
  } = useSearchableUserList<ChannelBanEntry>({
    loadPage: ({ searchQuery: query, offset, signal, onSuccess, onError }) => {
      dispatch(
        listChannelBans(basicChannelInfo.id, query, offset, {
          signal,
          onSuccess: data => {
            onSuccess({
              entries: data.bans.map(fromChannelBanEntryJson),
              hasMore: data.hasMoreBans,
            })
          },
          onError,
        }),
      )
    },
    getEntryKey: ban => ban.userId,
  })

  const onUnbanned = (userId: SbUserId) => {
    setBannedUsers(prev => prev?.filter(b => b.userId !== userId))
  }

  let searchContent
  if (searchError) {
    searchContent = (
      <UserListSearchResults>
        <ErrorText>
          {t('chat.channelSettings.bannedUsers.loadError', 'Failed to load banned users.')}
        </ErrorText>
      </UserListSearchResults>
    )
  } else if (bannedUsers?.length === 0 && !hasMoreBans) {
    // Entries get removed from the loaded list locally as they're unbanned, so an emptied page
    // must keep the scroll list (and its load-more trigger) mounted while the server still has
    // more bans to show.
    searchContent = (
      <UserListSearchResults>
        <UserListNoResults>
          {searchQuery
            ? t(
                'chat.channelSettings.bannedUsers.noSearchResults',
                'No banned users match your search',
              )
            : t('chat.channelSettings.bannedUsers.noBans', 'No one is banned from this channel')}
        </UserListNoResults>
      </UserListSearchResults>
    )
  } else {
    const banItems = (bannedUsers ?? []).map(ban => (
      <BannedUserRow
        key={ban.userId}
        ban={ban}
        channelId={basicChannelInfo.id}
        channelName={basicChannelInfo.name}
        onUnbanned={onUnbanned}
      />
    ))

    searchContent = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreBans}
        hasNextData={hasMoreBans}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMoreBans}>
        <UserListSearchResults>{banItems}</UserListSearchResults>
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

function BannedUserRow({
  ban,
  channelId,
  channelName,
  onUnbanned,
}: {
  ban: ChannelBanEntry
  channelId: SbChannelId
  channelName: string
  onUnbanned: (userId: SbUserId) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  // The ban list response includes the banning moderators in its user data, so this resolves for
  // any manually placed ban; automated bans have no moderator to show.
  const bannedByName = useAppSelector(s =>
    ban.bannedBy !== undefined ? s.users.byId.get(ban.bannedBy)?.name : undefined,
  )

  return (
    <UserListCardRow>
      <UserCardContent>
        <StyledAvatar userId={ban.userId} />

        <UserListCardInfo>
          <UserListCardUsername userId={ban.userId} interactive={false} />
          <UserListCardSubtitle>
            {bannedByName
              ? t('chat.channelSettings.bannedUsers.bannedDateBy', 'Banned {{date}} by {{name}}', {
                  date: userListDateFormat.format(ban.banTime),
                  name: bannedByName,
                })
              : t('chat.channelSettings.bannedUsers.bannedDate', 'Banned {{date}}', {
                  date: userListDateFormat.format(ban.banTime),
                })}
          </UserListCardSubtitle>
          {ban.reason ? (
            <Tooltip text={ban.reason} position='bottom'>
              <UserListCardSubtitle>{ban.reason}</UserListCardSubtitle>
            </Tooltip>
          ) : null}
          {ban.automated ? (
            <Badge>{t('chat.channelSettings.bannedUsers.automatedBadge', 'Automated')}</Badge>
          ) : null}
        </UserListCardInfo>
      </UserCardContent>

      <UserListCardActions>
        <TextButton
          label={t('chat.channelSettings.bannedUsers.unban', 'Unban')}
          onClick={() =>
            dispatch(
              openDialog({
                type: DialogType.ChannelUnbanUser,
                initData: {
                  channelId,
                  channelName,
                  userId: ban.userId,
                  onSuccess: () => onUnbanned(ban.userId),
                },
              }),
            )
          }
        />
      </UserListCardActions>
    </UserListCardRow>
  )
}
