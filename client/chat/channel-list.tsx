import { debounce } from 'lodash-es'
import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { BasicChannelInfo } from '../../common/chat'
import { ConnectedChannelInfoCard } from '../chat/channel-info-card'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch } from '../redux-hooks'
import { SearchInput } from '../search/search-input'
import { useStableCallback } from '../state-hooks'
import { colorError, colorTextFaint } from '../styles/colors'
import { headline5, subtitle1 } from '../styles/typography'
import { searchChannels } from './action-creators'

const SEARCH_CHANNELS_LIMIT = 10

const Container = styled.div`
  padding: 12px 24px;

  display: flex;
  flex-direction: column;
`

const PageHeadline = styled.div`
  ${headline5};
  margin-top: 16px;
  margin-bottom: 8px;
`

const StyledSearchInput = styled(SearchInput)`
  width: 256px;
`

const SearchResults = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
  overflow-y: auto;
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
  const dispatch = useAppDispatch()

  const [channels, setChannels] = useState<BasicChannelInfo[]>()
  const [currentPage, setCurrentPage] = useState(-1)
  const [hasMoreChannels, setHasMoreChannels] = useState(true)

  const [isLoadingMoreChannels, setIsLoadingMoreChannels] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useLocationSearchParam('q')
  const abortControllerRef = useRef<AbortController>()

  const [refreshToken, triggerRefresh] = useRefreshToken()
  const debouncedSearchRef = useRef(
    debounce((searchQuery: string) => {
      // Just need to clear the search results here and let the carousel initiate the network
      // request.
      setSearchQuery(searchQuery)
      setSearchError(undefined)
      setChannels(undefined)
      setCurrentPage(-1)
      setHasMoreChannels(true)
      triggerRefresh()
    }, 100),
  )

  const onSearchChange = useStableCallback((searchQuery: string) => {
    debouncedSearchRef.current(searchQuery)
  })

  const onLoadMoreChannels = useStableCallback(() => {
    setIsLoadingMoreChannels(true)
    setCurrentPage(currentPage + 1)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      searchChannels(searchQuery, SEARCH_CHANNELS_LIMIT, currentPage + 1, {
        signal: abortControllerRef.current.signal,
        onSuccess: data => {
          setIsLoadingMoreChannels(false)
          setChannels((channels ?? []).concat(data.channelInfos))
          setHasMoreChannels(data.channelInfos.length >= SEARCH_CHANNELS_LIMIT)
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

  let searchContent
  if (searchError) {
    searchContent = <ErrorText>There was an error retrieving the chat channels.</ErrorText>
  } else if (channels?.length === 0) {
    searchContent = <NoResults>No matching chat channels.</NoResults>
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
        {channelItems}
      </InfiniteScrollList>
    )
  }

  return (
    <Container>
      <PageHeadline>Channel list</PageHeadline>
      <StyledSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <SearchResults>{searchContent}</SearchResults>
    </Container>
  )
}
