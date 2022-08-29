import keycode from 'keycode'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { UserRelationshipJson } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user'
import { ConnectedAvatar } from '../avatars/avatar'
import { useObservedDimensions } from '../dom/dimension-hooks'
import FriendsIcon from '../icons/material/group-24px.svg'
import FriendAddIcon from '../icons/material/group_add-24px.svg'
import FriendSettingsIcon from '../icons/material/manage_accounts-24px.svg'
import { JsonLocalStorageValue } from '../local-storage'
import { HotkeyProp, IconButton, useButtonHotkey } from '../material/button'
import { Popover, useAnchorPosition } from '../material/popover'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { TabItem, Tabs } from '../material/tabs'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSettingsDialog } from '../settings/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import { useForceUpdate, useStableCallback } from '../state-hooks'
import { alphaDisabled, colorDividers, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { body2, headline6, overline, singleLine, subtitle1 } from '../styles/typography'
import { getRelationshipsIfNeeded } from './action-creators'
import { areUserEntriesEqual, sortUserEntries, useUserEntriesSelector } from './sorted-user-ids'
import { ConnectedUserContextMenu } from './user-context-menu'
import { useUserOverlays } from './user-overlays'
import { ConnectedUserProfileOverlay } from './user-profile-overlay'

const ALT_E: HotkeyProp = { keyCode: keycode('e'), altKey: true }

const FadedFriendsIcon = styled(FriendsIcon)`
  color: ${colorTextSecondary};
`

const FadedFriendAddIcon = styled(FriendAddIcon)`
  color: ${colorTextSecondary};
`

const FadedFriendSettingsIcon = styled(FriendSettingsIcon)`
  color: ${colorTextSecondary};
`

const IconContainer = styled.div``

const CountText = styled.div`
  ${singleLine};
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  line-height: 12px;
`

export function NumberedFriendsIcon({ count }: { count: number }) {
  return (
    <IconContainer>
      <FadedFriendsIcon />
      <CountText>{count}</CountText>
    </IconContainer>
  )
}

const PopoverContents = styled.div`
  height: calc(var(--sb-popover-max-height) * 0.667);
  width: 320px;
  display: flex;
  flex-direction: column;
`

function useRelationshipsLoader() {
  const dispatch = useAppDispatch()
  const userId = useAppSelector(s => s.auth.user.id)

  useEffect(() => {
    const controller = new AbortController()
    dispatch(
      getRelationshipsIfNeeded({
        signal: controller.signal,
        onSuccess: () => {},
        onError: () => {
          dispatch(openSnackbar({ message: 'Failed to load friends list' }))
        },
      }),
    )

    return () => {
      controller.abort()
    }
  }, [dispatch, userId])
}

export function FriendsListActivityButton() {
  useRelationshipsLoader()
  const [anchor, setAnchor] = useState<HTMLElement>()
  const onClick = useStableCallback((event: React.MouseEvent) => {
    setAnchor(event.currentTarget as HTMLElement)
  })
  const onDismiss = useStableCallback(() => {
    setAnchor(undefined)
  })
  const [, anchorX, anchorY] = useAnchorPosition('right', 'bottom', anchor ?? null)

  const buttonRef = useRef<HTMLButtonElement>(null)
  useButtonHotkey({ ref: buttonRef, hotkey: ALT_E })

  const friendCount = useAppSelector(s => s.relationships.friends.size)

  return (
    <>
      <Tooltip text='Friends (Alt + E)' position='left'>
        <IconButton
          ref={buttonRef}
          icon={<NumberedFriendsIcon count={friendCount} />}
          onClick={onClick}
          testName={'friends-list-button'}
        />
      </Tooltip>
      <Popover
        open={!!anchor}
        onDismiss={onDismiss}
        anchorX={(anchorX ?? 0) - 8}
        anchorY={(anchorY ?? 0) - 8}
        originX='right'
        originY='bottom'>
        <PopoverContents>
          <FriendsPopover onDismiss={onDismiss} />
        </PopoverContents>
      </Popover>
    </>
  )
}

enum FriendsListTab {
  List = 'List',
  Requests = 'Requests',
  Settings = 'Settings',
}

const savedFriendsListTab = new JsonLocalStorageValue<FriendsListTab>('friendsListTab')

const FriendsListHeader = styled.div`
  position: relative;
  flex-shrink: 0;
  padding: 8px 16px 4px;
`

const FriendsListTabsContainer = styled.div`
  max-width: 212px;
  margin: 0 auto;
  padding-left: var(--pixel-shove-x, 0px);
  padding-bottom: 16px;
`

const TitleText = styled.div`
  ${headline6};
  color: ${colorTextSecondary};
`

const FriendsListContent = styled.div`
  flex-grow: 1;
`

export function FriendsPopover({ onDismiss }: { onDismiss: () => void }) {
  useRelationshipsLoader()
  const dispatch = useAppDispatch()
  const forceUpdate = useForceUpdate()
  const activeTab = savedFriendsListTab.getValue() ?? FriendsListTab.List
  const onTabChange = useStableCallback((tab: FriendsListTab) => {
    if (tab === FriendsListTab.Settings) {
      // TODO(tec27): Open to the correct part of settings once it's there
      onDismiss()
      dispatch(openSettingsDialog())
      return
    }

    savedFriendsListTab.setValue(tab)
    // TODO(tec27): Would probably be nice to write a hook that uses useSyncExternalStore to
    // subscribe to the local storage value instead of forcing an update here, would be useful
    // elsewhere as well
    forceUpdate()
  })

  // NOTE(tec27): We grab the height of the content container here so we can increase the viewport
  // of Virtuoso. Virtuoso uses getBoundingClientRect() to retrieve viewport dimensions (and cannot
  // be customized for viewports), which causes problems if the virtualized list is in a container
  // that has its dimensions animated via CSS transforms (e.g. popovers). Potentially we end up
  // rendering double the necessary items this way, but that tradeoff is better than not rendering
  // enough items to actually fill up the viewport
  const [dimensionRef, contentRect] = useObservedDimensions()

  const [isAtTop, _isAtBottom, topElem, bottomElem] = useScrollIndicatorState()

  return (
    <>
      <FriendsListHeader>
        <FriendsListTabsContainer>
          <Tabs activeTab={activeTab} onChange={onTabChange}>
            <TabItem
              text={<FadedFriendsIcon />}
              title={'Friends list'}
              value={FriendsListTab.List}
            />
            <TabItem
              text={<FadedFriendAddIcon />}
              title={'Add friends'}
              value={FriendsListTab.Requests}
            />
            <TabItem
              text={<FadedFriendSettingsIcon />}
              title={'Social settings'}
              value={FriendsListTab.Settings}
            />
          </Tabs>
        </FriendsListTabsContainer>
        <TitleText>{activeTab === FriendsListTab.Requests ? 'Add friends' : 'Friends'}</TitleText>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </FriendsListHeader>
      <FriendsListContent ref={dimensionRef}>
        {topElem}
        {activeTab === FriendsListTab.Requests ? (
          <FriendRequestsList height={contentRect?.height ?? 0} />
        ) : (
          <FriendsList height={contentRect?.height ?? 0} />
        )}
        {bottomElem}
      </FriendsListContent>
    </>
  )
}

const EmptyList = styled.div`
  ${subtitle1};
  padding: 32px 16px 48px;

  color: ${colorTextFaint};
  text-align: center;
`

const ListOverline = styled.div<{ $firstOverline?: boolean }>`
  ${overline};
  ${singleLine};
  margin: 0 8px;
  padding: ${props => (props.$firstOverline ? '4px' : '20px')} 8px 0;

  color: ${colorTextSecondary};
  line-height: 36px;
`

const VertPadding = styled.div<{ context?: unknown }>`
  width: 100%;
  height: 8px;
`

enum FriendsListRowType {
  Header,
  Online,
  Offline,
}

interface HeaderData {
  type: FriendsListRowType.Header
  label: string
  count: number
}

interface OnlineData {
  type: FriendsListRowType.Online
  userId: SbUserId
}

interface OfflineData {
  type: FriendsListRowType.Offline
  userId: SbUserId
}

type FriendsListRowData = HeaderData | OnlineData | OfflineData

function FriendsList({ height }: { height: number }) {
  const friends = useAppSelector(s => s.relationships.friends)
  const friendUserEntries = useAppSelector(useUserEntriesSelector(friends), areUserEntriesEqual)
  const sortedFriends = useMemo(() => sortUserEntries(friendUserEntries), [friendUserEntries])

  // TODO(tec27): actually use online/offline stuff
  const rowData = useMemo((): ReadonlyArray<FriendsListRowData> => {
    let result: FriendsListRowData[] = [
      { type: FriendsListRowType.Header, label: 'Online', count: sortedFriends.length },
    ]

    result = result.concat(
      sortedFriends.map(userId => ({ type: FriendsListRowType.Online, userId })),
    )

    return result
  }, [sortedFriends])

  const renderRow = useCallback((index: number, row: FriendsListRowData) => {
    if (row.type === FriendsListRowType.Header) {
      return (
        <ListOverline key={row.label} $firstOverline={index === 0}>
          {row.label} ({row.count})
        </ListOverline>
      )
    } else {
      const faded = row.type === FriendsListRowType.Offline
      return <FriendEntry userId={row.userId} faded={faded} key={row.userId} />
    }
  }, [])

  return sortedFriends.length === 0 ? (
    <EmptyList>Nothing to see here</EmptyList>
  ) : (
    <Virtuoso
      components={{ Footer: VertPadding }}
      data={rowData}
      itemContent={renderRow}
      increaseViewportBy={height}
    />
  )
}

enum FriendRequestsRowType {
  Header,
  User,
}

interface FriendRequestsHeaderData {
  type: FriendRequestsRowType.Header
  label: string
  count: number
}

interface FriendRequestsUserData {
  type: FriendRequestsRowType.User
  userId: SbUserId
  relationship: UserRelationshipJson
}

type FriendRequestsRowData = FriendRequestsHeaderData | FriendRequestsUserData

function FriendRequestsList({ height }: { height: number }) {
  const incomingRequests = useAppSelector(s => s.relationships.incomingRequests)
  const outgoingRequests = useAppSelector(s => s.relationships.outgoingRequests)
  const incomingUserEntries = useAppSelector(
    useUserEntriesSelector(incomingRequests),
    areUserEntriesEqual,
  )
  const outgoingUserEntries = useAppSelector(
    useUserEntriesSelector(outgoingRequests),
    areUserEntriesEqual,
  )
  const sortedIncoming = useMemo(() => sortUserEntries(incomingUserEntries), [incomingUserEntries])
  const sortedOutgoing = useMemo(() => sortUserEntries(outgoingUserEntries), [outgoingUserEntries])

  const rowData = useMemo((): ReadonlyArray<FriendRequestsRowData> => {
    let result: FriendRequestsRowData[] = []
    if (sortedIncoming.length > 0) {
      result.push({
        type: FriendRequestsRowType.Header,
        label: 'Incoming',
        count: sortedIncoming.length,
      })

      result = result.concat(
        sortedIncoming.map(userId => ({
          type: FriendRequestsRowType.User,
          userId,
          relationship: incomingRequests.get(userId)!,
        })),
      )
    }

    if (sortedOutgoing.length > 0) {
      result.push({
        type: FriendRequestsRowType.Header,
        label: 'Outgoing',
        count: sortedOutgoing.length,
      })

      result = result.concat(
        sortedOutgoing.map(userId => ({
          type: FriendRequestsRowType.User,
          userId,
          relationship: outgoingRequests.get(userId)!,
        })),
      )
    }

    return result
  }, [incomingRequests, outgoingRequests, sortedIncoming, sortedOutgoing])

  const renderRow = useCallback((index: number, row: FriendRequestsRowData) => {
    if (row.type === FriendRequestsRowType.Header) {
      return (
        <ListOverline key={row.label} $firstOverline={index === 0}>
          {row.label} ({row.count})
        </ListOverline>
      )
    } else {
      // TODO(tec27): add buttons on the right side to accept/reject the request (or cancel an
      // outgoing request)
      return <FriendEntry userId={row.userId} key={row.userId} />
    }
  }, [])

  return rowData.length === 0 ? (
    <EmptyList>Nothing to see here</EmptyList>
  ) : (
    <Virtuoso
      components={{ Footer: VertPadding }}
      data={rowData}
      itemContent={renderRow}
      increaseViewportBy={height}
    />
  )
}

const StyledAvatar = styled(ConnectedAvatar)`
  width: 32px;
  height: 32px;

  display: inline-block;

  margin: 2px 16px 2px 0;
`
const LoadingName = styled.div`
  width: 64px;
  height: 20px;
  margin: 8px 0;
  display: inline-block;

  background-color: ${colorDividers};
  border-radius: 2px;
`

const fadedCss = css`
  color: ${colorTextFaint};
  ${StyledAvatar}, ${LoadingName} {
    opacity: ${alphaDisabled};
  }
`

const FriendEntryRoot = styled.div<{ $isOverlayOpen?: boolean; $faded?: boolean }>`
  ${body2};
  height: 44px;
  margin: 0 8px;
  padding: 4px 8px;

  border-radius: 2px;
  line-height: 36px;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.08);
  }

  ${props => {
    if (props.$isOverlayOpen) {
      return 'background-color: rgba(255, 255, 255, 0.08);'
    }
    return ''
  }}

  ${props => {
    if (props.$faded) {
      return fadedCss
    }
    return ''
  }}
`

const FriendEntryName = styled.span`
  ${singleLine};
  display: inline-block;
`

function FriendEntry({
  userId,
  faded = false,
  style,
}: {
  userId: SbUserId
  faded?: boolean
  style?: React.CSSProperties
}) {
  const user = useAppSelector(s => s.users.byId.get(userId))

  const {
    clickableElemRef,
    profileOverlayProps,
    contextMenuProps,
    onClick,
    onContextMenu,
    isOverlayOpen,
  } = useUserOverlays<HTMLDivElement>({
    userId,
    profileAnchorX: 'left',
    profileAnchorY: 'top',
    profileOriginX: 'right',
    profileOriginY: 'top',
    profileOffsetX: -4,
  })

  return (
    <div style={style}>
      <ConnectedUserProfileOverlay {...profileOverlayProps} />
      <ConnectedUserContextMenu {...contextMenuProps} />

      <FriendEntryRoot
        ref={clickableElemRef}
        key='entry'
        $faded={faded}
        $isOverlayOpen={isOverlayOpen}
        onClick={onClick}
        onContextMenu={onContextMenu}>
        <StyledAvatar userId={userId} />
        {user ? (
          <FriendEntryName>{user.name}</FriendEntryName>
        ) : (
          <LoadingName aria-label='Username loading…' />
        )}
      </FriendEntryRoot>
    </div>
  )
}
