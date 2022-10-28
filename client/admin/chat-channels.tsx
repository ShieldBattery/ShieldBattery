import { debounce } from 'lodash-es'
import React, { useRef, useState } from 'react'
import styled from 'styled-components'
import { ChannelInfo } from '../../common/chat'
import { apiUrl } from '../../common/urls'
import { getMessageHistory, retrieveUserList } from '../chat/action-creators'
import { ChannelUserList } from '../chat/channel-user-list'
import ChannelIcon from '../icons/material/image-24px.svg'
import Carousel from '../lists/carousel'
import { RaisedButton } from '../material/button'
import Card from '../material/card'
import MessageList from '../messaging/message-list'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { fetchJson } from '../network/fetch'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { SearchInput } from '../search/search-input'
import { useStableCallback } from '../state-hooks'
import { colorError, colorTextFaint } from '../styles/colors'
import { Body1, headline5, headline6, Headline6, singleLine, subtitle1 } from '../styles/typography'

const SEARCH_CHANNELS_LIMIT = 10
const CHANNEL_MESSAGES_LIMIT = 50

const Container = styled.div`
  max-width: 960px;
  height: 100%;
  padding: 0 16px;

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

const SearchContainer = styled.div`
  height: 88px;
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

const StyledCarousel = styled(Carousel)`
  max-width: 960px;
`

const ChannelThumbnail = styled(Card)`
  width: 420px;
  padding: 16px;

  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: center;

  &:not(:first-child) {
    margin-left: 16px;
  }
`

const StyledChannelIcon = styled(ChannelIcon)`
  width: 56px;
  height: auto;
  flex-shrink: 0;
`

const ChannelInfoContainer = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  margin: 0 8px;
  overflow: hidden;
`

const ChannelInfoName = styled(Headline6)`
  ${singleLine};
`

const ChannelHeadline = styled.div`
  ${headline6};
  margin-bottom: 8px;
`

const ChannelContainer = styled.div`
  width: 100%;
  overflow: hidden;

  flex-grow: 1;
  display: flex;
`

const StyledMessageList = styled(MessageList)`
  flex-grow: 1;
  max-width: 960px;
  min-width: 320px;
`

export function AdminChatChannels() {
  const dispatch = useAppDispatch()
  const [channels, setChannels] = useState<ChannelInfo[]>()
  const [currentPage, setCurrentPage] = useState(-1)
  const [hasMoreChannels, setHasMoreChannels] = useState(true)

  const [isLoadingMoreChannels, setIsLoadingMoreChannels] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useLocationSearchParam('q')
  const abortControllerRef = useRef<AbortController>()

  const carouselRef = useRef(null)
  const debouncedSearchRef = useRef(
    debounce((searchQuery: string) => {
      // Just need to clear the search results here and let the carousel initiate the network
      // request.
      setSearchQuery(searchQuery)
      setSearchError(undefined)
      setChannels(undefined)
      setCurrentPage(-1)
      setHasMoreChannels(true)
      if (carouselRef.current) {
        // TODO(2Pac): Fix the types once the carousel is ported to TypeScript.
        ;(carouselRef.current as any).reset()
      }
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

    fetchJson<ChannelInfo[]>(
      apiUrl`admin/chat/?q=${searchQuery}&limit=${SEARCH_CHANNELS_LIMIT}&page=${currentPage + 1}`,
      { signal: abortControllerRef.current.signal },
    )
      .then(data => {
        setIsLoadingMoreChannels(false)
        setChannels((channels ?? []).concat(data))
        setHasMoreChannels(data.length >= SEARCH_CHANNELS_LIMIT)
      })
      .catch(err => {
        setIsLoadingMoreChannels(false)
        setSearchError(err)
      })
  })

  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo>()
  const channelMessages = useAppSelector(s =>
    selectedChannel ? s.chat.idToMessages.get(selectedChannel.id) : undefined,
  )

  const onLoadMoreMessages = useStableCallback(() => {
    if (selectedChannel) {
      dispatch(getMessageHistory(selectedChannel.id, CHANNEL_MESSAGES_LIMIT))
    }
  })

  const onViewClick = useStableCallback((newChannel: ChannelInfo) => {
    if (selectedChannel?.id === newChannel.id) {
      return
    }
    setSelectedChannel(newChannel)
    dispatch(retrieveUserList(newChannel.id))
  })

  let searchContent
  if (searchError) {
    searchContent = <ErrorText>There was an error retrieving the chat channels.</ErrorText>
  } else if (channels?.length === 0) {
    searchContent = <NoResults>No matching chat channel.</NoResults>
  } else {
    const channelItems = (channels ?? []).map(channel => (
      <ChannelThumbnail key={channel.id}>
        <StyledChannelIcon />
        <ChannelInfoContainer>
          <ChannelInfoName>{channel.name}</ChannelInfoName>
          {channel.userCount ? (
            <Body1>{`${channel.userCount} member${channel.userCount > 1 ? 's' : ''}`}</Body1>
          ) : null}
        </ChannelInfoContainer>
        <RaisedButton label='View' onClick={() => onViewClick(channel)} />
      </ChannelThumbnail>
    ))

    searchContent = (
      <StyledCarousel
        ref={carouselRef}
        isLoading={isLoadingMoreChannels}
        hasMoreItems={hasMoreChannels}
        onLoadMoreData={onLoadMoreChannels}>
        {channelItems}
      </StyledCarousel>
    )
  }

  return (
    <Container>
      <PageHeadline>Chat channels</PageHeadline>
      <StyledSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <SearchContainer>{searchContent}</SearchContainer>
      {selectedChannel ? (
        <>
          <ChannelHeadline>{selectedChannel.name}</ChannelHeadline>
          <ChannelContainer>
            <StyledMessageList
              messages={channelMessages?.messages ?? []}
              onLoadMoreMessages={onLoadMoreMessages}
              loading={channelMessages?.loadingHistory}
              hasMoreHistory={channelMessages?.hasHistory}
              refreshToken={selectedChannel.id}
            />
            <ChannelUserList channelId={selectedChannel.id} />
          </ChannelContainer>
        </>
      ) : (
        <NoResults>Select a channel to view.</NoResults>
      )}
    </Container>
  )
}
