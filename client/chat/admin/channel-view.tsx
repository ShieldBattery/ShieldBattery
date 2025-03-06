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
import { ElevatedButton } from '../../material/button'
import { DestructiveMenuItem } from '../../material/menu/item'
import { ChatContext, ChatContextValue } from '../../messaging/chat-context'
import { MessageList } from '../../messaging/message-list'
import { replace } from '../../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../../network/abortable-thunk'
import { fetchJson } from '../../network/fetch'
import { isFetchError } from '../../network/fetch-errors'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { openSnackbar } from '../../snackbars/action-creators'
import { useStableCallback } from '../../state-hooks'
import { CenteredContentContainer } from '../../styles/centered-container'
import { FlexSpacer } from '../../styles/flex-spacer'
import { bodyLarge, titleLarge } from '../../styles/typography'
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

const Container = styled(CenteredContentContainer).attrs({ $targetHorizontalPadding: 16 })`
  display: flex;
  flex-direction: column;
  padding-top: 8px;
  gap: 8px;
`

const ChannelHeaderContainer = styled.div`
  width: 100%;
  height: 72px;
  padding: 8px;

  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;

  background-color: var(--theme-container-low);
  border-radius: 8px;
`

const ChannelHeadline = styled.div`
  ${titleLarge};
`

const ChannelContainer = styled.div`
  width: 100%;
  overflow: hidden;

  flex-grow: 1;
  display: flex;
  gap: 8px;
`

const StyledMessageList = styled(MessageList)`
  flex-grow: 1;
  min-width: 320px;
  padding-bottom: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const StyledUserList = styled(ChannelUserList)`
  margin-bottom: 8px;
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
                <ElevatedButton
                  label='Remove banner'
                  disabled={isRemovingBanner}
                  onClick={onRemoveBannerClick}
                />
                <ElevatedButton
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
              <StyledUserList active={activeUsers} />
            </ChannelContainer>
          </ChatContext.Provider>
        </>
      ) : (
        <LoadingDotsArea />
      )}
    </Container>
  )
}
