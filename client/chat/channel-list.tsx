import { debounce } from 'lodash-es'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { BasicChannelInfo } from '../../common/chat.js'
import { urlPath } from '../../common/urls.js'
import { useTrackPageView } from '../analytics/analytics.js'
import { ConnectedChannelInfoCard } from '../chat/channel-info-card.js'
import { MaterialIcon } from '../icons/material/material-icon.js'
import InfiniteScrollList from '../lists/infinite-scroll-list.js'
import { useAutoFocusRef } from '../material/auto-focus.js'
import { RaisedButton } from '../material/button.js'
import { useLocationSearchParam } from '../navigation/router-hooks.js'
import { push } from '../navigation/routing.js'
import { useRefreshToken } from '../network/refresh-token.js'
import { useAppDispatch } from '../redux-hooks.js'
import { SearchInput, SearchInputHandle } from '../search/search-input.js'
import { useStableCallback } from '../state-hooks.js'
import { colorError, colorTextFaint } from '../styles/colors.js'
import { FlexSpacer } from '../styles/flex-spacer.js'
import { headline4, subtitle1 } from '../styles/typography.js'
import { searchChannels } from './action-creators.js'

const Container = styled.div`
  padding: 16px 24px;

  display: flex;
  flex-direction: column;
`

const TitleBar = styled.div`
  display: flex;
  align-items: baseline;
  gap: 16px;
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
  useTrackPageView('/chat/')
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
      // TODO(2Pac): Make the infinite scroll lost in charge of the loading state, so we don't have
      // to do this here, which is pretty unintuitive.
      setIsLoadingMoreChannels(false)
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
        <FlexSpacer />
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
