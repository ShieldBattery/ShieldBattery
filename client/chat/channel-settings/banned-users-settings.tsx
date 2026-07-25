import { debounce } from 'lodash-es'
import { useEffect, useRef, useState } from 'react'
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
import { elevationPlus1 } from '../../material/shadows'
import { Tooltip } from '../../material/tooltip'
import { useRefreshToken } from '../../network/refresh-token'
import { useAppDispatch } from '../../redux-hooks'
import { SearchInput } from '../../search/search-input'
import { ErrorText } from '../../settings/settings-content'
import { ContainerLevel, containerStyles } from '../../styles/colors'
import { bodyLarge, labelMedium, singleLine, titleSmall } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { listChannelBans } from '../action-creators'

const bannedDateFormat = new Intl.DateTimeFormat(navigator.language, {
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

const UserCardRow = styled.div`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};

  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
`

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

const RowActions = styled.div`
  flex-shrink: 0;
  padding-right: 8px;
  display: flex;
  align-items: center;
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

const StyledUsername = styled(ConnectedUsername)`
  ${titleSmall};
  ${singleLine};
`

const BannedDateText = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const ReasonText = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
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

  const [bannedUsers, setBannedUsers] = useState<ChannelBanEntry[]>()
  const [hasMoreBans, setHasMoreBans] = useState(true)

  const [isLoadingMoreBans, setIsLoadingMoreBans] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useState('')
  const abortControllerRef = useRef<AbortController>(undefined)

  const [refreshToken, triggerRefresh] = useRefreshToken()
  // Clears the loaded entries and lets the infinite scroll list initiate a fresh network request.
  const resetBannedUsersList = () => {
    setIsLoadingMoreBans(false)
    setSearchError(undefined)
    setBannedUsers(undefined)
    setHasMoreBans(true)
    triggerRefresh()
  }
  const debouncedSearchRef = useRef(
    debounce((query: string) => {
      setSearchQuery(query)
      resetBannedUsersList()
    }, 100),
  )

  const onSearchChange = (query: string) => {
    debouncedSearchRef.current(query)
  }

  const onLoadMoreBans = () => {
    setIsLoadingMoreBans(true)
    setSearchError(undefined)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      listChannelBans(basicChannelInfo.id, searchQuery, bannedUsers?.length ?? 0, {
        signal: abortControllerRef.current.signal,
        onSuccess: data => {
          setIsLoadingMoreBans(false)
          setBannedUsers(prev => {
            const existing = prev ?? []
            // Dedupe against what we already have: the ordering depends on ban time, so an entry
            // lifted and re-placed between page loads can shift across a page boundary and
            // reappear in a later page.
            const seenUserIds = new Set(existing.map(b => b.userId))
            const newEntries = data.bans
              .map(fromChannelBanEntryJson)
              .filter(entry => !seenUserIds.has(entry.userId))
            return existing.concat(newEntries)
          })
          setHasMoreBans(data.hasMoreBans)
        },
        onError: err => {
          setIsLoadingMoreBans(false)
          setSearchError(err)
        },
      }),
    )
  }

  useEffect(() => {
    const debouncedSearch = debouncedSearchRef.current
    return () => {
      abortControllerRef.current?.abort()
      debouncedSearch.cancel()
    }
  }, [])

  const onUnbanned = (userId: SbUserId) => {
    setBannedUsers(prev => prev?.filter(b => b.userId !== userId))
  }

  let searchContent
  if (searchError) {
    searchContent = (
      <SearchResults>
        <ErrorText>
          {t('chat.channelSettings.bannedUsers.loadError', 'Failed to load banned users.')}
        </ErrorText>
      </SearchResults>
    )
  } else if (bannedUsers?.length === 0) {
    searchContent = (
      <SearchResults>
        <NoResults>
          {searchQuery
            ? t(
                'chat.channelSettings.bannedUsers.noSearchResults',
                'No banned users match your search',
              )
            : t('chat.channelSettings.bannedUsers.noBans', 'No one is banned from this channel')}
        </NoResults>
      </SearchResults>
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
        <SearchResults>{banItems}</SearchResults>
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

  return (
    <UserCardRow>
      <UserCardContent>
        <StyledAvatar userId={ban.userId} />

        <UserInfoContainer>
          <StyledUsername userId={ban.userId} interactive={false} />
          <BannedDateText>
            {t('chat.channelSettings.bannedUsers.bannedDate', 'Banned {{date}}', {
              date: bannedDateFormat.format(ban.banTime),
            })}
          </BannedDateText>
          {ban.reason ? (
            <Tooltip text={ban.reason} position='bottom'>
              <ReasonText>{ban.reason}</ReasonText>
            </Tooltip>
          ) : null}
          {ban.automated ? (
            <Badge>{t('chat.channelSettings.bannedUsers.automatedBadge', 'Automated')}</Badge>
          ) : null}
        </UserInfoContainer>
      </UserCardContent>

      <RowActions>
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
      </RowActions>
    </UserCardRow>
  )
}
