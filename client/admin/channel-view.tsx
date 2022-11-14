import { debounce } from 'lodash-es'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  ChannelInfo,
  ChatMessage,
  GetChannelHistoryServerResponse,
  SbChannelId,
} from '../../common/chat'
import { apiUrl } from '../../common/urls'
import { SbUser } from '../../common/users/sb-user'
import { renderChannelMessage } from '../chat/channel'
import { ChannelUserList } from '../chat/channel-user-list'
import { ThunkAction } from '../dispatch-registry'
import ChannelIcon from '../icons/material/image-24px.svg'
import Carousel from '../lists/carousel'
import { RaisedButton } from '../material/button'
import Card from '../material/card'
import MessageList from '../messaging/message-list'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'
import { useAppDispatch } from '../redux-hooks'
import { SearchInput } from '../search/search-input'
import { useStableCallback } from '../state-hooks'
import { colorError, colorTextFaint } from '../styles/colors'
import { Body1, headline5, headline6, Headline6, singleLine, subtitle1 } from '../styles/typography'

const SEARCH_CHANNELS_LIMIT = 10
const CHANNEL_MESSAGES_LIMIT = 50

export function getChannelMessages(
  channelId: SbChannelId,
  channelMessages: ChatMessage[],
  limit: number,
  spec: RequestHandlingSpec<GetChannelHistoryServerResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const earliestMessageTime = channelMessages[0]?.time ?? -1

    try {
      const result = await fetchJson<GetChannelHistoryServerResponse>(
        apiUrl`admin/chat/${channelId}/messages?limit=${limit}&beforeTime=${earliestMessageTime}`,
        {
          signal: spec.signal,
        },
      )

      dispatch({
        type: '@users/loadUsers',
        payload: result.mentions.concat(result.users),
      })

      return result
    } catch (err) {
      throw err
    }
  })
}

export function getChannelUsers(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<SbUser[]>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    try {
      const result = await fetchJson<SbUser[]>(apiUrl`admin/chat/${channelId}/users`, {
        signal: spec.signal,
      })

      dispatch({
        type: '@users/loadUsers',
        payload: result,
      })

      return result
    } catch (err) {
      throw err
    }
  })
}

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

let prevSearchChannelsAbortController: AbortController | undefined

export function ChannelSelector({ onSelect }: { onSelect: (channelI: ChannelInfo) => void }) {
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
    // We save a reference to the abort controller we call the fetch with, since it could be aborted
    // after the fetch promise resolves, but before the callback is called.
    prevSearchChannelsAbortController = abortControllerRef.current

    fetchJson<ChannelInfo[]>(
      apiUrl`admin/chat/?q=${searchQuery}&limit=${SEARCH_CHANNELS_LIMIT}&page=${currentPage + 1}`,
      { signal: abortControllerRef.current.signal },
    )
      .then(data => {
        if (prevSearchChannelsAbortController?.signal.aborted) {
          return
        }
        setIsLoadingMoreChannels(false)
        setChannels((channels ?? []).concat(data))
        setHasMoreChannels(data.length >= SEARCH_CHANNELS_LIMIT)
      })
      .catch(err => {
        setIsLoadingMoreChannels(false)
        setSearchError(err)
      })
  })

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

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
        <RaisedButton label='View' onClick={() => onSelect(channel)} />
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
    <>
      <StyledSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <SearchContainer>{searchContent}</SearchContainer>
    </>
  )
}

let prevGetChannelMessagesAbortController: AbortController | undefined
let prevGetChannelUsersAbortController: AbortController | undefined

export function AdminChannelView() {
  const dispatch = useAppDispatch()
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo>()

  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([])
  const [hasMoreChannelMessages, setHasMoreChannelMessages] = useState(true)
  const [isLoadingMoreChannelMessages, setIsLoadingMoreChannelMessages] = useState(false)

  const [channelUsers, setChannelUsers] = useState<SbUser[]>([])

  const getChannelMessagesAbortControllerRef = useRef<AbortController>()
  const getChannelUsersAbortControllerRef = useRef<AbortController>()

  const onLoadMoreMessages = useStableCallback(() => {
    if (!selectedChannel) {
      return
    }

    setIsLoadingMoreChannelMessages(true)

    getChannelMessagesAbortControllerRef.current?.abort()
    getChannelMessagesAbortControllerRef.current = new AbortController()
    // We save a reference to the abort controller we call the fetch with, since it could be aborted
    // after the fetch promise resolves, but before the callback is called.
    prevGetChannelMessagesAbortController = getChannelMessagesAbortControllerRef.current

    dispatch(
      getChannelMessages(selectedChannel.id, channelMessages, CHANNEL_MESSAGES_LIMIT, {
        signal: getChannelMessagesAbortControllerRef.current.signal,
        onSuccess: result => {
          if (prevGetChannelMessagesAbortController?.signal.aborted) {
            return
          }
          setIsLoadingMoreChannelMessages(false)
          setHasMoreChannelMessages(result.messages.length >= CHANNEL_MESSAGES_LIMIT)

          const newMessages = result.messages as ChatMessage[]
          setChannelMessages(newMessages.concat(channelMessages))
        },
        onError: () => {
          setIsLoadingMoreChannelMessages(false)
        },
      }),
    )
  })

  const onChannelSelect = useStableCallback((newChannel: ChannelInfo) => {
    if (selectedChannel?.id === newChannel.id) {
      return
    }

    setSelectedChannel(newChannel)
    setChannelUsers([])
    setChannelMessages([])
    setHasMoreChannelMessages(true)

    getChannelUsersAbortControllerRef.current?.abort()
    getChannelUsersAbortControllerRef.current = new AbortController()
    // We save a reference to the abort controller we call the fetch with, since it could be aborted
    // after the fetch promise resolves, but before the callback is called.
    prevGetChannelUsersAbortController = getChannelUsersAbortControllerRef.current

    dispatch(
      getChannelUsers(newChannel.id, {
        signal: getChannelUsersAbortControllerRef.current.signal,
        onSuccess: result => {
          if (prevGetChannelUsersAbortController?.signal.aborted) {
            return
          }
          setChannelUsers(result)
        },
        onError: () => {},
      }),
    )
  })

  useEffect(() => {
    return () => {
      getChannelMessagesAbortControllerRef.current?.abort()
      getChannelUsersAbortControllerRef.current?.abort()
    }
  }, [])

  // We assume everyone is active in admin view, since tracking user activity is a hassle.
  const activeUsers = useMemo(() => new Set(channelUsers.map(u => u.id)), [channelUsers])

  return (
    <Container>
      <PageHeadline>Channel view</PageHeadline>
      <ChannelSelector onSelect={onChannelSelect} />
      {selectedChannel ? (
        <>
          <ChannelHeadline>{selectedChannel.name}</ChannelHeadline>
          <ChannelContainer>
            <StyledMessageList
              messages={channelMessages}
              onLoadMoreMessages={onLoadMoreMessages}
              loading={isLoadingMoreChannelMessages}
              hasMoreHistory={hasMoreChannelMessages}
              refreshToken={selectedChannel.id}
              renderMessage={renderChannelMessage}
            />
            <ChannelUserList active={activeUsers} />
          </ChannelContainer>
        </>
      ) : (
        <NoResults>Select a channel to view.</NoResults>
      )}
    </Container>
  )
}
