import { debounce } from 'lodash-es'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { BasicChannelInfo } from '../../common/chat'
import { urlPath } from '../../common/urls'
import { ConnectedChannelInfoCard } from '../chat/channel-info-card'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { useAutoFocusRef } from '../material/auto-focus'
import { RaisedButton } from '../material/button'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { push } from '../navigation/routing'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch } from '../redux-hooks'
import { SearchInput, SearchInputHandle } from '../search/search-input'
import { useStableCallback } from '../state-hooks'
import { colorError, colorTextFaint } from '../styles/colors'
import { headline4, subtitle1 } from '../styles/typography'
import { searchChannels } from './action-creators'

const Container = styled.div`
  padding: 16px 24px;

  display: flex;
  flex-direction: column;
`

const TitleBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const PageHeadline = styled.div`
  ${headline4};
`

const StyledSearchInput = styled(SearchInput)`
  width: 256px;
`

const SearchResults = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
`

const NoResults = styled.div`
  ${subtitle1};

  color: ${colorTextFaint};
`

const ErrorText = styled.div`
  ${subtitle1};

  color: ${colorError};
`

export function ChannelList() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const autoFocusRef = useAutoFocusRef<SearchInputHandle>()

  const [channels, setChannels] = useState<BasicChannelInfo[]>()
  const [hasMoreChannels, setHasMoreChannels] = useState(true)

  const [isLoadingMoreChannels, setIsLoadingMoreChannels] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useLocationSearchParam('q')
  const abortControllerRef = useRef<AbortController>()

  const [refreshToken, triggerRefresh] = useRefreshToken()
  const debouncedSearchRef = useRef(
    debounce((searchQuery: string) => {
      // Just need to clear the search results here and let the infinite scroll list initiate the
      // network request.
      setSearchQuery(searchQuery)
      setSearchError(undefined)
      setChannels(undefined)
      setHasMoreChannels(true)
      triggerRefresh()
    }, 100),
  )

  const onSearchChange = useStableCallback((searchQuery: string) => {
    debouncedSearchRef.current(searchQuery)
  })

  const onLoadMoreChannels = useStableCallback(() => {
    setIsLoadingMoreChannels(true)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      searchChannels(searchQuery, channels?.length ?? 0, {
        signal: abortControllerRef.current.signal,
        onSuccess: data => {
          setIsLoadingMoreChannels(false)
          setChannels((channels ?? []).concat(data.channelInfos))
          setHasMoreChannels(data.hasMoreChannels)
        },
        onError: err => {
          setIsLoadingMoreChannels(false)
          setSearchError(err)
        },
      }),
    )
  })

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  const onCreateChannelClick = useStableCallback(() => {
    push(urlPath`/chat/new`)
  })

  let searchContent
  if (searchError) {
    searchContent = (
      <SearchResults>
        <ErrorText>
          {t(
            'chat.channelList.retrievingError',
            'There was an error retrieving the chat channels.',
          )}
        </ErrorText>
      </SearchResults>
    )
  } else if (channels?.length === 0) {
    searchContent = (
      <SearchResults>
        <NoResults>
          {t('chat.channelList.noMatchingChannels', 'No matching chat channels.')}
        </NoResults>
      </SearchResults>
    )
  } else {
    const channelItems = (channels ?? []).map(channel => (
      <ConnectedChannelInfoCard
        key={channel.id}
        channelId={channel.id}
        channelName={channel.name}
      />
    ))

    searchContent = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreChannels}
        hasNextData={hasMoreChannels}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMoreChannels}>
        <SearchResults>{channelItems}</SearchResults>
      </InfiniteScrollList>
    )
  }

  return (
    <Container>
      <TitleBar>
        <PageHeadline>{t('chat.channelList.pageHeadline', 'Chat channels')}</PageHeadline>
        <RaisedButton
          label={t('chat.channelList.createChannel', 'Create channel')}
          iconStart={<MaterialIcon icon='add' />}
          onClick={onCreateChannelClick}
        />
      </TitleBar>
      <StyledSearchInput
        ref={autoFocusRef}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
      />
      {searchContent}
    </Container>
  )
}
