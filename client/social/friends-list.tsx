import * as React from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { appendToMultimap } from '../../common/data-structures/maps'
import { FriendActivityStatus, UserRelationshipJson } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { ConnectedAvatar } from '../avatars/avatar'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { ScrollDivider, useScrollIndicatorState } from '../material/scroll-indicator'
import { TabItem, Tabs } from '../material/tabs'
import { useNavigationTracker } from '../navigation/navigation-tracker'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge, labelMedium, singleLine, titleLarge, titleSmall } from '../styles/typography'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { areUserEntriesEqual, useUserEntriesSelector } from '../users/user-entries'
import { useUserOverlays } from '../users/user-overlays'
import { ConnectedUserProfileOverlay } from '../users/user-profile-overlay'
import {
  acceptFriendRequest,
  declineFriendRequest,
  getRelationshipsIfNeeded,
  removeFriendRequest,
} from './action-creators'
import { userRelationshipErrorToString } from './relationship-errors'

const FadedFriendsIcon = styledWithAttrs(MaterialIcon, { icon: 'group' })`
  color: var(--theme-on-surface-variant);
`

const FadedFriendAddIcon = styledWithAttrs(MaterialIcon, { icon: 'group_add' })`
  color: var(--theme-on-surface-variant);
`

const FadedFriendSettingsIcon = styledWithAttrs(MaterialIcon, { icon: 'manage_accounts' })`
  color: var(--theme-on-surface-variant);
`

export function useRelationshipsLoader() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const userId = useAppSelector(s => s.auth.self?.user.id)
  const isConnected = useAppSelector(s => s.network.isConnected)

  useEffect(() => {
    if (!isConnected) return () => {}

    const controller = new AbortController()
    dispatch(
      getRelationshipsIfNeeded({
        signal: controller.signal,
        onSuccess: () => {},
        onError: () => {
          snackbarController.showSnackbar(
            t('social.errors.friendsList.load', 'Failed to load friends list'),
          )
        },
      }),
    )

    return () => {
      controller.abort()
    }
  }, [dispatch, isConnected, snackbarController, t, userId])
}

enum FriendsListTab {
  List = 'List',
  Requests = 'Requests',
  Settings = 'Settings',
}

const FriendsListHeader = styled.div`
  position: relative;
  flex-shrink: 0;
  padding: 8px 16px 4px;
`

const FriendsListTabsContainer = styled.div`
  max-width: 212px;
  margin: 0 auto;
  padding-bottom: 16px;
`

const TitleText = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
`

const FriendsListContent = styled.div`
  flex-grow: 1;
`

function validateFriendsListTab(value: unknown): FriendsListTab | undefined {
  return Object.values(FriendsListTab).includes(value as FriendsListTab)
    ? (value as FriendsListTab)
    : undefined
}

export function FriendsList() {
  const { t } = useTranslation()
  const { onNavigation } = useNavigationTracker()

  useRelationshipsLoader()
  const dispatch = useAppDispatch()
  const [activeTab, setActiveTab] = useUserLocalStorageValue(
    'friendsList.tab',
    FriendsListTab.List,
    validateFriendsListTab,
  )

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
          <Tabs
            activeTab={activeTab}
            onChange={tab => {
              if (tab === FriendsListTab.Settings) {
                // TODO(tec27): Open to the correct part of settings once it's there
                dispatch(openSettings())
                onNavigation()
                return
              }
              setActiveTab(tab)
            }}>
            <TabItem
              text={<FadedFriendsIcon />}
              title={t('social.friendsList.tabs.friendsList', 'Friends list')}
              value={FriendsListTab.List}
            />
            <TabItem
              text={<FadedFriendAddIcon />}
              title={t('social.friendsList.tabs.addFriends', 'Add friends')}
              value={FriendsListTab.Requests}
            />
            <TabItem
              text={<FadedFriendSettingsIcon />}
              title={t('social.friendsList.tabs.socialSettings', 'Social settings')}
              value={FriendsListTab.Settings}
            />
          </Tabs>
        </FriendsListTabsContainer>
        <TitleText>
          {activeTab === FriendsListTab.Requests
            ? t('social.friendsList.title.addFriends', 'Add friends')
            : t('social.friendsList.title.friends', 'Friends')}
        </TitleText>
        <ScrollDivider $show={!isAtTop} $showAt='bottom' />
      </FriendsListHeader>
      <FriendsListContent ref={dimensionRef}>
        {topElem}
        {activeTab === FriendsListTab.Requests ? (
          <VirtualizedFriendRequestsList height={contentRect?.height ?? 0} />
        ) : (
          <VirtualizedFriendsList height={contentRect?.height ?? 0} />
        )}
        {bottomElem}
      </FriendsListContent>
    </>
  )
}

const EmptyList = styled.div`
  ${bodyLarge};
  padding: 32px 16px 48px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const ListOverline = styled.div<{ $firstOverline?: boolean }>`
  ${labelMedium};
  ${singleLine};
  margin: 0 8px;
  padding: ${props => (props.$firstOverline ? '4px' : '20px')} 8px 0;

  color: var(--theme-on-surface-variant);
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

function VirtualizedFriendsList({ height }: { height: number }) {
  const { t } = useTranslation()
  const friends = useAppSelector(s => s.relationships.friends)
  const friendActivityStatus = useAppSelector(s => s.relationships.friendActivityStatus)
  const sortedFriendUserEntries = useAppSelector(
    useUserEntriesSelector(friends),
    areUserEntriesEqual,
  )
  const friendsByStatus = useMemo(() => {
    const result = new Map<FriendActivityStatus, SbUserId[]>()
    for (const [id] of sortedFriendUserEntries) {
      appendToMultimap(result, friendActivityStatus.get(id) ?? FriendActivityStatus.Offline, id)
    }
    return result
  }, [friendActivityStatus, sortedFriendUserEntries])

  const rowData = useMemo((): ReadonlyArray<FriendsListRowData> => {
    const onlineFriends = friendsByStatus.get(FriendActivityStatus.Online) ?? []
    let result: FriendsListRowData[] = [
      {
        type: FriendsListRowType.Header,
        label: t('social.friendsList.header.online', 'Online'),
        count: onlineFriends.length,
      },
    ]

    result = result.concat(
      onlineFriends.map(userId => ({ type: FriendsListRowType.Online, userId })),
    )

    const offlineFriends = friendsByStatus.get(FriendActivityStatus.Offline) ?? []
    if (offlineFriends.length > 0) {
      result.push({
        type: FriendsListRowType.Header,
        label: t('social.friendsList.header.offline', 'Offline'),
        count: offlineFriends.length,
      })

      result = result.concat(
        offlineFriends.map(userId => ({ type: FriendsListRowType.Offline, userId })),
      )
    }

    return result
  }, [friendsByStatus, t])

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

  return friends.size === 0 ? (
    <EmptyList>{t('common.lists.empty', 'Nothing to see here')}</EmptyList>
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

function VirtualizedFriendRequestsList({ height }: { height: number }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()!
  const incomingRequests = useAppSelector(s => s.relationships.incomingRequests)
  const outgoingRequests = useAppSelector(s => s.relationships.outgoingRequests)
  const sortedIncomingUserEntries = useAppSelector(
    useUserEntriesSelector(incomingRequests),
    areUserEntriesEqual,
  )
  const sortedOutgoingUserEntries = useAppSelector(
    useUserEntriesSelector(outgoingRequests),
    areUserEntriesEqual,
  )

  const rowData = useMemo((): ReadonlyArray<FriendRequestsRowData> => {
    let result: FriendRequestsRowData[] = []
    if (sortedIncomingUserEntries.length > 0) {
      result.push({
        type: FriendRequestsRowType.Header,
        label: t('social.friendsList.header.incoming', 'Incoming'),
        count: sortedIncomingUserEntries.length,
      })

      result = result.concat(
        sortedIncomingUserEntries.map(([userId]) => ({
          type: FriendRequestsRowType.User,
          userId,
          relationship: incomingRequests.get(userId)!,
        })),
      )
    }

    if (sortedOutgoingUserEntries.length > 0) {
      result.push({
        type: FriendRequestsRowType.Header,
        label: t('social.friendsList.header.outgoing', 'Outgoing'),
        count: sortedOutgoingUserEntries.length,
      })

      result = result.concat(
        sortedOutgoingUserEntries.map(([userId]) => ({
          type: FriendRequestsRowType.User,
          userId,
          relationship: outgoingRequests.get(userId)!,
        })),
      )
    }

    return result
  }, [incomingRequests, outgoingRequests, sortedIncomingUserEntries, sortedOutgoingUserEntries, t])

  const renderRow = useCallback(
    (index: number, row: FriendRequestsRowData) => {
      if (row.type === FriendRequestsRowType.Header) {
        return (
          <ListOverline key={row.label} $firstOverline={index === 0}>
            {row.label} ({row.count})
          </ListOverline>
        )
      } else {
        const actions =
          row.relationship.fromId === selfUser.id ? (
            <>
              <IconButton
                icon={<MaterialIcon icon='close' />}
                title={t('common.actions.remove', 'Remove')}
                onClick={() => {
                  dispatch(
                    removeFriendRequest(row.userId, {
                      onSuccess: () => {},
                      onError: err => {
                        snackbarController.showSnackbar(
                          userRelationshipErrorToString(
                            err,
                            t(
                              'social.errors.friendsList.errorRemovingFriendRequest',
                              'Error removing friend request',
                            ),
                            t,
                          ),
                          DURATION_LONG,
                        )
                      },
                    }),
                  )
                }}
              />
            </>
          ) : (
            <>
              <IconButton
                icon={<MaterialIcon icon='close' />}
                title={t('common.actions.decline', 'Decline')}
                onClick={() => {
                  dispatch(
                    declineFriendRequest(row.userId, {
                      onSuccess: () => {},
                      onError: err => {
                        snackbarController.showSnackbar(
                          userRelationshipErrorToString(
                            err,
                            t(
                              'social.errors.friendsList.errorDecliningFriendRequest',
                              'Error declining friend request',
                            ),
                            t,
                          ),
                          DURATION_LONG,
                        )
                      },
                    }),
                  )
                }}
              />
              <IconButton
                icon={<MaterialIcon icon='check' />}
                title={t('common.actions.accept', 'Accept')}
                onClick={() => {
                  dispatch(
                    acceptFriendRequest(row.userId, {
                      onSuccess: () => {},
                      onError: err => {
                        snackbarController.showSnackbar(
                          userRelationshipErrorToString(
                            err,
                            t(
                              'social.errors.friendsList.errorAcceptingFriendRequest',
                              'Error accepting friend request',
                            ),
                            t,
                          ),
                          DURATION_LONG,
                        )
                      },
                    }),
                  )
                }}
              />
            </>
          )
        return <FriendEntry userId={row.userId} key={row.userId} actions={actions} />
      }
    },
    [selfUser.id, t, dispatch, snackbarController],
  )

  return rowData.length === 0 ? (
    <EmptyList>{t('common.lists.empty', 'Nothing to see here')}</EmptyList>
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

  background-color: rgb(from var(--theme-on-surface-variant) r g b / 0.7);
  border-radius: 4px;
`

const fadedCss = css`
  color: var(--theme-on-surface-variant);
  ${StyledAvatar}, ${LoadingName} {
    opacity: var(--theme-disabled-opacity);
  }
`

const FriendEntryActions = styled.div`
  display: flex;
  align-items: center;
`

const FriendEntryRoot = styled.div<{ $isOverlayOpen?: boolean; $faded?: boolean }>`
  ${titleSmall};
  height: 44px;
  margin: 0 8px;
  padding: 4px 8px;

  display: flex;
  align-items: center;

  border-radius: 4px;
  line-height: 36px;

  &:hover {
    cursor: pointer;
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  ${props => {
    if (props.$isOverlayOpen) {
      return 'background-color: rgb(from var(--theme-on-surface) r g b / 0.08);'
    }
    return ''
  }}

  ${props => {
    if (props.$faded) {
      return fadedCss
    }
    return ''
  }}

  ${FriendEntryActions} {
    opacity: 0;
  }

  &:hover ${FriendEntryActions} {
    opacity: 1;
  }
`

const FriendEntryName = styled.div`
  ${singleLine};
  flex-grow: 1;
`

function FriendEntry({
  userId,
  faded = false,
  style,
  actions,
}: {
  userId: SbUserId
  faded?: boolean
  style?: React.CSSProperties
  actions?: React.ReactNode
}) {
  const { t } = useTranslation()
  const user = useAppSelector(s => s.users.byId.get(userId))

  const { profileOverlayProps, contextMenuProps, onClick, onContextMenu, isOverlayOpen } =
    useUserOverlays({
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
        key='entry'
        $faded={faded}
        $isOverlayOpen={isOverlayOpen}
        onClick={onClick}
        onContextMenu={onContextMenu}>
        <StyledAvatar userId={userId} />
        {user ? (
          <FriendEntryName>{user.name}</FriendEntryName>
        ) : (
          <LoadingName aria-label={t('social.friendsList.loadingUsername', 'Username loading…')} />
        )}
        {actions ? <FriendEntryActions>{actions}</FriendEntryActions> : null}
      </FriendEntryRoot>
    </div>
  )
}
