import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import {
  ChatMessage,
  ChatServiceErrorCode,
  GetChannelHistoryServerResponse,
  GetChannelInfoResponse,
  SbChannelId,
  makeSbChannelId,
} from '../../../common/chat'
import { appendToMultimap } from '../../../common/data-structures/maps'
import { apiUrl, urlPath } from '../../../common/urls'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { ThunkAction } from '../../dispatch-registry'
import { FilledButton } from '../../material/button'
import { DestructiveMenuItem, MenuItem } from '../../material/menu/item'
import { ChatContext } from '../../messaging/chat-context'
import {
  MenuItemCategory as MessageMenuItemCategory,
  MessageMenuProps,
} from '../../messaging/message-context-menu'
import { MessageList } from '../../messaging/message-list'
import { replace } from '../../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../../network/abortable-thunk'
import { fetchJson } from '../../network/fetch'
import { isFetchError } from '../../network/fetch-errors'
import { useRefreshToken } from '../../network/refresh-token'
import { LoadingDotsArea } from '../../progress/dots'
import { useStableCallback } from '../../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../../styles/centered-container'
import { FlexSpacer } from '../../styles/flex-spacer'
import { bodyLarge, labelMedium, titleLarge } from '../../styles/typography'
import {
  MenuItemCategory as UserMenuItemCategory,
  UserMenuProps,
} from '../../users/user-context-menu'
import { areUserEntriesEqual, useUserEntriesSelector } from '../../users/user-entries'
import { getChannelUserPermissionsAsAdmin } from '../action-creators'
import { ChannelMessage } from '../channel'
import { ChannelContext } from '../channel-context'
import { UserList } from '../channel-user-list'
import { AdminChannelSettings } from './admin-channel-settings'

const CHANNEL_MESSAGES_LIMIT = 50

function getChannelInfo(
  channelId: SbChannelId,
  spec: RequestHandlingSpec<GetChannelInfoResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    return await fetchJson(apiUrl`admin/chat/${channelId}`, { signal: spec.signal })
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

const ChannelHeadlineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const ChannelHeadline = styled.div`
  ${titleLarge};
`

const AdminViewBadge = styled.div`
  ${labelMedium};
  padding: 2px 8px;
  border-radius: 4px;
  background-color: var(--theme-amber);
  color: var(--theme-on-amber);
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

const StyledUserList = styled(UserList)`
  margin-bottom: 8px;
`

/**
 * Channel details the admin menus need beyond `ChannelContext`'s ID, sourced from the admin view's
 * locally-fetched channel info rather than the store.
 */
const AdminChannelInfoContext = createContext<{
  /** The current owner of the channel, if it has one (official channels don't). */
  ownerId?: SbUserId
  /** Whether this is an official channel. Official channels can't have an owner. */
  official: boolean
}>({ official: false })

function AdminChannelUserMenu({ userId, items, onMenuClose, MenuComponent }: UserMenuProps) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUserId = useAppSelector(s => s.auth.self!.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const { channelId } = useContext(ChannelContext)
  const { ownerId, official } = useContext(AdminChannelInfoContext)

  const menuItems = new Map(items)
  if (user && user.id !== selfUserId) {
    appendToMultimap(
      menuItems,
      UserMenuItemCategory.Destructive,
      <DestructiveMenuItem
        key='kick'
        text={`Kick ${user.name}`}
        onClick={() => {
          dispatch(
            openDialog({
              type: DialogType.ChannelKickUserConfirmation,
              initData: { channelId, userId: user.id, isAdmin: true },
            }),
          )
          onMenuClose()
        }}
      />,
    )
    appendToMultimap(
      menuItems,
      UserMenuItemCategory.Destructive,
      <DestructiveMenuItem
        key='ban'
        text={`Ban ${user.name}`}
        onClick={() => {
          dispatch(
            openDialog({
              type: DialogType.ChannelBanUser,
              initData: { channelId, userId: user.id, isAdmin: true },
            }),
          )
          onMenuClose()
        }}
      />,
    )
    // Official channels can't have an owner, and transferring ownership to the current owner is
    // meaningless — the server rejects both, so don't offer them.
    if (!official && user.id !== ownerId) {
      appendToMultimap(
        menuItems,
        UserMenuItemCategory.General,
        <MenuItem
          key='transfer-ownership'
          text='Transfer ownership'
          onClick={() => {
            dispatch(
              openDialog({
                type: DialogType.ChannelTransferOwnership,
                initData: { channelId, userId: user.id, isAdmin: true },
              }),
            )
            onMenuClose()
          }}
        />,
      )
    }
    appendToMultimap(
      menuItems,
      UserMenuItemCategory.General,
      <MenuItem
        key='edit-permissions'
        text='Edit permissions'
        onClick={() => {
          dispatch(
            getChannelUserPermissionsAsAdmin(channelId, user.id, {
              onSuccess: result => {
                dispatch(
                  openDialog({
                    type: DialogType.ChannelUserPermissions,
                    initData: {
                      channelId,
                      userId: user.id,
                      permissions: result.permissions,
                      isAdmin: true,
                      onSuccess: () => {},
                    },
                  }),
                )
              },
              onError: () => {
                snackbarController.showSnackbar(`Error fetching permissions for ${user.name}`)
              },
            }),
          )
          onMenuClose()
        }}
      />,
    )
  }

  return <MenuComponent items={menuItems} userId={userId} onMenuClose={onMenuClose} />
}

function AdminChannelMessageMenu({
  messageId,
  items,
  onMenuClose,
  MenuComponent,
}: MessageMenuProps) {
  const dispatch = useAppDispatch()
  const { channelId } = useContext(ChannelContext)

  const menuItems = new Map(items)
  appendToMultimap(
    menuItems,
    MessageMenuItemCategory.Destructive,
    <DestructiveMenuItem
      key='delete-message'
      text='Delete message'
      onClick={() => {
        dispatch(
          openDialog({
            type: DialogType.AdminDeleteChatMessage,
            initData: { channelId, messageId },
          }),
        )
        onMenuClose()
      }}
    />,
  )

  return <MenuComponent items={menuItems} messageId={messageId} onMenuClose={onMenuClose} />
}

export function AdminChannelView({
  channelId,
  channelName: channelNameFromRoute,
}: {
  channelId: SbChannelId
  channelName: string
}) {
  const dispatch = useAppDispatch()
  const [channelInfoResponse, setChannelInfoResponse] = useState<GetChannelInfoResponse>()
  const [channelInfoRefreshToken, refreshChannelInfo] = useRefreshToken()
  const [error, setError] = useState<Error>()

  const channelInfo = channelInfoResponse?.channelInfo
  const detailedChannelInfo = channelInfoResponse?.detailedChannelInfo
  const joinedChannelInfo = channelInfoResponse?.joinedChannelInfo

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>([])
  const [hasMoreChannelMessages, setHasMoreChannelMessages] = useState(true)
  const [isLoadingMoreChannelMessages, setIsLoadingMoreChannelMessages] = useState(false)

  const [channelUsers, setChannelUsers] = useState<SbUser[]>([])

  // We assume everyone is active in admin view, since tracking user activity is a hassle.
  const activeUsers = useMemo(() => new Set(channelUsers.map(u => u.id)), [channelUsers])
  const sortedActiveUserEntries = useAppSelector(
    useUserEntriesSelector(activeUsers),
    areUserEntriesEqual,
  )

  const sortedActiveUserIds = useMemo(
    () => sortedActiveUserEntries.map(([id]) => id),
    [sortedActiveUserEntries],
  )

  const getChannelMessagesAbortControllerRef = useRef<AbortController>(undefined)

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
          setChannelInfoResponse(result)
          setError(undefined)
        },
        onError: err => {
          setError(err)
        },
      }),
    )

    return () => abortController.abort()
  }, [channelId, channelInfoRefreshToken, dispatch])

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
            <ChannelHeadlineRow>
              <ChannelHeadline>#{channelInfo.name}</ChannelHeadline>
              <AdminViewBadge>Admin view</AdminViewBadge>
            </ChannelHeadlineRow>

            <FlexSpacer />

            <FilledButton
              label='Channel settings'
              disabled={!detailedChannelInfo || !joinedChannelInfo}
              onClick={() => setIsSettingsOpen(true)}
            />
          </ChannelHeaderContainer>

          <AdminChannelSettings
            isOpen={isSettingsOpen}
            basicChannelInfo={channelInfo}
            detailedChannelInfo={detailedChannelInfo}
            joinedChannelInfo={joinedChannelInfo}
            onCloseSettings={() => {
              setIsSettingsOpen(false)
              // The settings screen saves directly to the server, so pull the channel's info back
              // in to keep this view (and the next visit to the settings) in step with it.
              refreshChannelInfo()
            }}
          />

          <ChannelContext.Provider value={{ channelId: channelInfo.id }}>
            <AdminChannelInfoContext.Provider
              value={{ ownerId: joinedChannelInfo?.ownerId, official: channelInfo.official }}>
              <ChatContext.Provider
                value={{
                  UserMenu: AdminChannelUserMenu,
                  MessageMenu: AdminChannelMessageMenu,
                }}>
                <ChannelContainer>
                  <StyledMessageList
                    messages={channelMessages}
                    onLoadMoreMessages={onLoadMoreMessages}
                    loading={isLoadingMoreChannelMessages}
                    hasMoreHistory={hasMoreChannelMessages}
                    refreshToken={channelInfo.id}
                    MessageComponent={ChannelMessage}
                  />
                  <StyledUserList active={sortedActiveUserIds} idle={[]} offline={[]} />
                </ChannelContainer>
              </ChatContext.Provider>
            </AdminChannelInfoContext.Provider>
          </ChannelContext.Provider>
        </>
      ) : (
        <LoadingDotsArea />
      )}
    </Container>
  )
}
