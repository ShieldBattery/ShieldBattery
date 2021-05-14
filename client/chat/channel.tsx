import React, { useCallback, useEffect, useRef, useState } from 'react'
import { List as VirtualizedList, ListRowRenderer } from 'react-virtualized'
import styled, { css } from 'styled-components'
import { MULTI_CHANNEL } from '../../common/flags'
import Avatar from '../avatars/avatar'
import WindowListener from '../dom/window-listener'
import MenuItem from '../material/menu/item'
import Chat from '../messaging/chat'
import { Message } from '../messaging/message-records'
import { push } from '../navigation/routing'
import UserProfileOverlay from '../profile/user-profile-overlay'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePrevious } from '../state-hooks'
import { alphaDisabled, colorTextSecondary } from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'
import { navigateToWhisper } from '../whispers/action-creators'
import {
  activateChannel,
  deactivateChannel,
  getMessageHistory,
  joinChannel,
  retrieveUserList,
  sendMessage,
} from './action-creators'
import {
  JoinChannelMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
} from './chat-message-layout'
import { ChatMessageType } from './chat-message-records'
import { Users as UsersRecord } from './chat-reducer'

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;
`

const userListRow = css`
  ${singleLine};

  margin: 0 8px;
  padding: 0 8px;
  line-height: 36px;
`

const OVERLINE_HEIGHT = 36 + 24
const FIRST_OVERLINE_HEIGHT = 36 + 8

const UserListOverline = styled.div`
  ${overline}
  ${userListRow};
  height: ${OVERLINE_HEIGHT}px;
  color: ${colorTextSecondary};

  padding-top: 24px;

  &:first-child {
    padding-top: 8px;
  }
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;

  display: inline-block;

  margin: 2px 16px 2px 0;
`

const fadedCss = css`
  color: ${colorTextSecondary};
  ${StyledAvatar} {
    opacity: ${alphaDisabled};
  }
`

const USER_ENTRY_HEIGHT = 44

interface UserListEntryItemProps {
  isOverlayOpen?: boolean
  faded?: boolean
}

const UserListEntryItem = styled.div<UserListEntryItemProps>`
  ${body2};
  ${userListRow};
  height: ${USER_ENTRY_HEIGHT}px;
  border-radius: 2px;
  padding-top: 4px;
  padding-bottom: 4px;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.08);
  }

  ${props => {
    if (props.isOverlayOpen) {
      return 'background-color: rgba(255, 255, 255, 0.08);'
    }
    return ''
  }}

  ${props => {
    if (props.faded) {
      return fadedCss
    }
    return ''
  }}
`

const USER_LIST_PADDING_HEIGHT = 8

const UserListPadding = styled.div`
  width: 100%;
  height: ${USER_LIST_PADDING_HEIGHT}px;
`

const UserListName = styled.span`
  ${singleLine};
  display: inline-block;
`

interface UserListEntryProps {
  user: string
  faded?: boolean
  style?: any
  onWhisperClick: (user: string) => void
}

const UserListEntry = React.memo<UserListEntryProps>(props => {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const userEntryRef = useRef(null)

  const onOpenOverlay = useCallback(() => {
    setOverlayOpen(true)
  }, [])
  const onCloseOverlay = useCallback(() => {
    setOverlayOpen(false)
  }, [])

  const { onWhisperClick: onWhisperClickProp, user } = props
  const onWhisperClick = useCallback(() => {
    onWhisperClickProp(user)
  }, [onWhisperClickProp, user])

  return (
    <div style={props.style}>
      <UserProfileOverlay
        key={'overlay'}
        open={overlayOpen}
        onDismiss={onCloseOverlay}
        anchor={userEntryRef.current}
        user={props.user}>
        <MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />
      </UserProfileOverlay>

      <UserListEntryItem
        ref={userEntryRef}
        key={'entry'}
        faded={!!props.faded}
        isOverlayOpen={overlayOpen}
        onClick={onOpenOverlay}>
        <StyledAvatar user={props.user} />
        <UserListName>{props.user}</UserListName>
      </UserListEntryItem>
    </div>
  )
})

const UsersVirtualizedList = styled(VirtualizedList)`
  &:focus,
  & > div:focus {
    outline: none;
  }
`

interface UserListProps {
  users: ReturnType<typeof UsersRecord>
  onWhisperClick: (user: string) => void
}

class UserList extends React.Component<UserListProps> {
  state = {
    width: 0,
    height: 0,
  }
  _contentRef = React.createRef<HTMLDivElement>()
  _listRef = React.createRef<VirtualizedList>()

  componentDidMount() {
    this.updateDimensions()
  }

  componentDidUpdate(prevProps: UserListProps) {
    if (prevProps.users !== this.props.users) {
      this._listRef.current?.recomputeRowHeights()
    }
  }

  getRowHeight = ({ index }: { index: number }) => {
    const { active, idle, offline } = this.props.users
    if (index === 0) {
      return FIRST_OVERLINE_HEIGHT
    } else if (index < active.size + 1) {
      return USER_ENTRY_HEIGHT
    }

    let i = index - (active.size + 1)
    if (idle.size) {
      if (i === 0) {
        return OVERLINE_HEIGHT
      } else if (i < idle.size + 1) {
        return USER_ENTRY_HEIGHT
      }

      i -= idle.size + 1
    }

    if (offline.size) {
      if (i === 0) {
        return OVERLINE_HEIGHT
      } else if (i < offline.size + 1) {
        return USER_ENTRY_HEIGHT
      }

      i -= offline.size + 1
    }

    if (i === 0) {
      return USER_LIST_PADDING_HEIGHT
    }

    throw new Error('Asked to size nonexistent user: ' + index)
  }

  renderRow: ListRowRenderer = ({ index, style }) => {
    const { active, idle, offline } = this.props.users
    if (index === 0) {
      // NOTE(tec27): We know the active header is always visible because this user is online
      return (
        <UserListOverline style={style} key={index}>
          Active ({active.size})
        </UserListOverline>
      )
    } else if (index < active.size + 1) {
      return (
        <UserListEntry
          style={style}
          user={active.get(index - 1)}
          key={index}
          onWhisperClick={this.props.onWhisperClick}
        />
      )
    }

    let i = index - (active.size + 1)
    if (idle.size) {
      if (i === 0) {
        return (
          <UserListOverline style={style} key={index}>
            Idle ({idle.size})
          </UserListOverline>
        )
      } else if (i < idle.size + 1) {
        return (
          <UserListEntry
            style={style}
            user={idle.get(i - 1)}
            key={index}
            onWhisperClick={this.props.onWhisperClick}
          />
        )
      }

      i -= idle.size + 1
    }

    if (offline.size) {
      if (i === 0) {
        return (
          <UserListOverline style={style} key={index}>
            Offline ({offline.size})
          </UserListOverline>
        )
      } else if (i < offline.size + 1) {
        return (
          <UserListEntry
            style={style}
            user={offline.get(i - 1)}
            key={index}
            onWhisperClick={this.props.onWhisperClick}
            faded={true}
          />
        )
      }

      i -= offline.size + 1
    }

    if (i === 0) {
      return <UserListPadding style={style} key={index} />
    }

    throw new Error('Asked to render nonexistent user: ' + index)
  }

  render() {
    const { active, idle, offline } = this.props.users
    const rowCount =
      1 + active.size + (idle.size ? 1 : 0) + idle.size + (offline.size ? 1 : 0) + offline.size + 1

    return (
      <UserListContainer ref={this._contentRef}>
        <WindowListener event='resize' listener={this.updateDimensions} />
        <UsersVirtualizedList
          ref={this._listRef}
          width={this.state.width}
          height={this.state.height}
          rowCount={rowCount}
          rowHeight={this.getRowHeight}
          rowRenderer={this.renderRow}
        />
      </UserListContainer>
    )
  }

  updateDimensions = () => {
    const width = this._contentRef.current?.clientWidth ?? 0
    const height = this._contentRef.current?.clientHeight ?? 0
    if (this.state.width !== width || this.state.height !== height) {
      this.setState({ width, height })
    }
  }
}

const MESSAGES_LIMIT = 50

const Container = styled.div`
  max-width: 1140px;
  height: 100%;
  margin: 0 auto;
  padding: 0;
  padding-left: var(--pixel-shove-x, 0);
  display: flex;
`

const LoadingArea = styled.div`
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const StyledChat = styled(Chat)`
  flex-grow: 1;
`

function renderMessage(msg: Message) {
  switch (msg.type) {
    case ChatMessageType.JoinChannel:
      return <JoinChannelMessage key={msg.id} time={msg.time} user={msg.user} />
    case ChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={msg.id} time={msg.time} user={msg.user} />
    case ChatMessageType.NewChannelOwner:
      return <NewChannelOwnerMessage key={msg.id} time={msg.time} newOwner={msg.newOwner} />
    case ChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={msg.id} channel={msg.channel} />
    default:
      return null
  }
}

interface ChatChannelProps {
  params: { channel: string }
}

export default function Channel(props: ChatChannelProps) {
  const channelName = decodeURIComponent(props.params.channel).toLowerCase()
  const dispatch = useAppDispatch()
  const channel = useAppSelector(s => s.chat.byName.get(channelName))

  const prevChannelName = usePrevious(channelName)
  const prevChannel = usePrevious(channel)
  const isInChannel = !!channel
  const isLeavingChannel = !isInChannel && prevChannel && prevChannelName === channelName

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with whispers/lobby?
  useEffect(() => {
    if (isLeavingChannel) {
      push('/')
    }
  }, [isLeavingChannel])

  useEffect(() => {
    if (isInChannel) {
      dispatch(retrieveUserList(channelName))
      dispatch(activateChannel(channelName) as any)
    } else if (!isLeavingChannel) {
      if (MULTI_CHANNEL) {
        dispatch(joinChannel(channelName))
      } else {
        push('/')
      }
    }

    return () => dispatch(deactivateChannel(channelName) as any)
  }, [isInChannel, isLeavingChannel, channelName, dispatch])

  const onLoadMoreMessages = useCallback(
    () => dispatch(getMessageHistory(channelName, MESSAGES_LIMIT)),
    [channelName, dispatch],
  )

  const onSendChatMessage = useCallback(
    (msg: string) => dispatch(sendMessage(channelName, msg)),
    [dispatch, channelName],
  )

  const onWhisperClick = useCallback((user: string) => navigateToWhisper(user), [])

  if (!channel) {
    return (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  const listProps = {
    messages: channel.messages,
    loading: channel.loadingHistory,
    hasMoreHistory: channel.hasHistory,
    refreshToken: channelName,
    renderMessage,
    onLoadMoreMessages,
  }
  const inputProps = {
    onSendChatMessage,
  }

  return (
    <Container>
      <StyledChat listProps={listProps} inputProps={inputProps} />
      <UserList users={channel.users} onWhisperClick={onWhisperClick} />
    </Container>
  )
}
