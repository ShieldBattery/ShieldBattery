import React, { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  ChatMessage,
  ChatServiceErrorCode,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  SbChannelId,
  makeSbChannelId,
} from '../../../common/chat'
import { CHANNEL_BANNERS } from '../../../common/flags'
import { apiUrl, urlPath } from '../../../common/urls'
import { SbUser } from '../../../common/users/sb-user'
import { ThunkAction } from '../../dispatch-registry'
import { RaisedButton } from '../../material/button'
import { DestructiveMenuItem } from '../../material/menu/item'
import { ChatContext, ChatContextValue } from '../../messaging/chat'
import MessageList from '../../messaging/message-list'
import { replace } from '../../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../../network/abortable-thunk'
import { fetchJson } from '../../network/fetch'
import { isFetchError } from '../../network/fetch-errors'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { openSnackbar } from '../../snackbars/action-creators'
import { useStableCallback } from '../../state-hooks'
import { background700, background800, colorError } from '../../styles/colors'
import { FlexSpacer } from '../../styles/flex-spacer'
import { headline6, subtitle1 } from '../../styles/typography'
import { deleteMessageAsAdmin, updateChannel } from '../action-creators'
import { renderChannelMessage } from '../channel'
import { ChannelUserList } from '../channel-user-list'

const CHANNEL_MESSAGES_LIMIT = 50

function getChannelInfo(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<GetChannelInfoResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`chat/${channelId}`, { signal: spec.signal })
  })
}

function getChannelMessages(
  channelId: SbChannelId,
  channelMessages: ChatMessage[],
  limit: number,
  spec: RequestHandlingSpec<GetChannelHistoryServerResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const earliestMessageTime = channelMessages[0]?.time ?? -1

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
  })
}

function getChannelUsers(channelId: SbChannelId, spec: RequestHandlingSpec<SbUser[]>): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<SbUser[]>(apiUrl`admin/chat/${channelId}/users`, {
      signal: spec.signal,
    })

    dispatch({
      type: '@users/loadUsers',
      payload: result,
    })

    return result
  })
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 0 16px;

  display: flex;
  flex-direction: column;

  background-color: ${background700};
`

const ChannelHeaderContainer = styled.div`
  width: 100%;
  max-width: 960px;
  height: 72px;
  padding: 8px;
  padding-right: 8px;
  background-color: ${background700};

  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`

const ChannelHeadline = styled.div`
  ${headline6};
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

  background-color: ${background800};
`

const ErrorText = styled.div`
  ${subtitle1};

  color: ${colorError};
`

export function AdminChannelView({
  channelId,
  channelName: channelNameFromRoute,
}: {
  channelId: SbChannelId
  channelName: string
}) {
  const dispatch = useAppDispatch()
  const [channelInfo, setChannelInfo] = useState<BasicChannelInfo>()
  const [error, setError] = useState<Error>()

  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([])
  const [hasMoreChannelMessages, setHasMoreChannelMessages] = useState(true)
  const [isLoadingMoreChannelMessages, setIsLoadingMoreChannelMessages] = useState(false)
  const [isRemovingBanner, setIsRemovingBanner] = useState(false)
  const [isRemovingBadge, setIsRemovingBadge] = useState(false)

  const [channelUsers, setChannelUsers] = useState<SbUser[]>([])

  const getChannelMessagesAbortControllerRef = useRef<AbortController>()

  useEffect(() => {
    if (channelInfo && channelNameFromRoute !== channelInfo.name) {
      replace(urlPath`/chat/admin/${channelInfo.id}/${channelInfo.name}/view`)
    }
  }, [channelInfo, channelNameFromRoute])

  useEffect(() => {
    const abortController = new AbortController()

    dispatch(
      getChannelInfo(makeSbChannelId(channelId), {
        signal: abortController.signal,
        onSuccess: result => {
          setChannelInfo(result.channelInfo)
          setError(undefined)
        },
        onError: err => {
          setError(err)
        },
      }),
    )

    return () => abortController.abort()
  }, [channelId, dispatch])

  useEffect(() => {
    const abortController = new AbortController()

    if (channelInfo) {
      dispatch(
        getChannelUsers(channelInfo.id, {
          signal: abortController.signal,
          onSuccess: result => {
            setChannelUsers(result)
          },
          onError: () => {},
        }),
      )
    }

    return () => abortController.abort()
  }, [channelInfo, dispatch])

  useEffect(() => {
    return () => {
      getChannelMessagesAbortControllerRef.current?.abort()
    }
  }, [])

  const onLoadMoreMessages = useStableCallback(() => {
    if (!channelInfo) {
      return
    }

    setIsLoadingMoreChannelMessages(true)

    getChannelMessagesAbortControllerRef.current?.abort()
    getChannelMessagesAbortControllerRef.current = new AbortController()

    dispatch(
      getChannelMessages(channelInfo.id, channelMessages, CHANNEL_MESSAGES_LIMIT, {
        signal: getChannelMessagesAbortControllerRef.current.signal,
        onSuccess: result => {
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

  const onRemoveBannerClick = useStableCallback(() => {
    setIsRemovingBanner(true)

    dispatch(
      updateChannel({
        channelId: channelInfo!.id,
        channelChanges: {
          deleteBanner: true,
        },
        spec: {
          onSuccess: () => {
            setIsRemovingBanner(false)
            dispatch(openSnackbar({ message: 'Banner successfully removed.' }))
          },
          onError: err => {
            setIsRemovingBanner(false)
            dispatch(openSnackbar({ message: 'Something went wrong while removing the banner.' }))
          },
        },
      }),
    )
  })

  const onRemoveBadgeClick = useStableCallback(() => {
    setIsRemovingBadge(true)

    dispatch(
      updateChannel({
        channelId: channelInfo!.id,
        channelChanges: {
          deleteBadge: true,
        },
        spec: {
          onSuccess: () => {
            setIsRemovingBadge(false)
            dispatch(openSnackbar({ message: 'Badge successfully removed.' }))
          },
          onError: err => {
            setIsRemovingBadge(false)
            dispatch(openSnackbar({ message: 'Something went wrong while removing the badge.' }))
          },
        },
      }),
    )
  })

  // We assume everyone is active in admin view, since tracking user activity is a hassle.
  const activeUsers = useMemo(() => new Set(channelUsers.map(u => u.id)), [channelUsers])

  const chatContextValue = useMemo<ChatContextValue>(
    () => ({
      modifyMessageMenuItems: (
        messageId: string,
        items: React.ReactNode[],
        onMenuClose: (event?: MouseEvent) => void,
      ) => {
        if (channelInfo) {
          items.push(
            <DestructiveMenuItem
              key='delete-message'
              text='Delete message'
              onClick={() => {
                dispatch(
                  deleteMessageAsAdmin(channelInfo.id, messageId, {
                    onSuccess: () => {
                      setChannelMessages(prev => prev.filter(m => m.id !== messageId))
                      dispatch(openSnackbar({ message: 'Message deleted' }))
                    },
                    onError: () => {
                      dispatch(openSnackbar({ message: 'Error deleting message' }))
                    },
                  }),
                )
                onMenuClose()
              }}
            />,
          )
        }
        return items
      },
    }),
    [channelInfo, dispatch],
  )

  if (error) {
    let errorText
    if (isFetchError(error)) {
      if (error.code === ChatServiceErrorCode.ChannelNotFound) {
        errorText = (
          <ErrorText>
            This channel could not be found. It might not exist, or it may have been re-created by
            someone else.
          </ErrorText>
        )
      } else {
        errorText = <ErrorText>An error occurred: {error.statusText}</ErrorText>
      }
    } else {
      errorText = (
        <ErrorText>
          Error getting channel info for #{channelNameFromRoute}: {error.message}
        </ErrorText>
      )
    }
    return (
      <Container>
        <ErrorText>{errorText}</ErrorText>
      </Container>
    )
  }

  return (
    <Container>
      {channelInfo ? (
        <>
          <ChannelHeaderContainer>
            <ChannelHeadline>#{channelInfo.name}</ChannelHeadline>

            <FlexSpacer />

            {CHANNEL_BANNERS ? (
              <>
                <RaisedButton
                  label='Remove banner'
                  disabled={isRemovingBanner}
                  onClick={onRemoveBannerClick}
                />
                <RaisedButton
                  label='Remove badge'
                  disabled={isRemovingBadge}
                  onClick={onRemoveBadgeClick}
                />
              </>
            ) : null}
          </ChannelHeaderContainer>

          <ChatContext.Provider value={chatContextValue}>
            <ChannelContainer>
              <StyledMessageList
                messages={channelMessages}
                onLoadMoreMessages={onLoadMoreMessages}
                loading={isLoadingMoreChannelMessages}
                hasMoreHistory={hasMoreChannelMessages}
                refreshToken={channelInfo.id}
                renderMessage={renderChannelMessage}
              />
              <ChannelUserList active={activeUsers} />
            </ChannelContainer>
          </ChatContext.Provider>
        </>
      ) : (
        <LoadingDotsArea />
      )}
    </Container>
  )
}
