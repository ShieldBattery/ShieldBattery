import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { appendToMultimap } from '../../common/data-structures/maps'
import { UserRelationshipKind } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { colorTextFaint } from '../styles/colors'
import { navigateToWhisper } from '../whispers/action-creators'
import {
  acceptFriendRequest,
  blockUser,
  navigateToUserProfile,
  removeFriend,
  removeFriendRequest,
  sendFriendRequest,
  unblockUser,
} from './action-creators'
import { userRelationshipErrorToString } from './relationship-errors'

const LoadingItem = styled(MenuItem)`
  color: ${colorTextFaint};
`

/**
 * All the possible categories of the menu items in the user context menu. In case you're not sure
 * what constitues a new category, a divider will be inserted between each category, so it might
 * help to think of it in those terms.
 *
 * **IMPORTANT**: The order of the values in this enum is used to render the menu item categories in
 * that same order.
 */
export enum MenuItemCategory {
  /** Contains general menu items, like view profile, whisper, mention */
  General = 'General',
  /** Contains party-related menu items, like invite/uninvite to/from party */
  Party = 'Party',
  /** Contains destructive menu items, like kick/ban from chat channels, lobbies */
  Destructive = 'Destructive',
}

export const ALL_MENU_ITEM_CATEGORIES: ReadonlyArray<MenuItemCategory> =
  Object.values(MenuItemCategory)

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  /**
   * An optional function that will be called when rendering menu items. If provided, the value
   * returned from this function will be used as the `children` of the menu. Mutating the input
   * value and returning it is okay.
   */
  modifyMenuItems?: (
    userId: SbUserId,
    items: Map<MenuItemCategory, React.ReactNode[]>,
    onMenuClose: (event?: MouseEvent) => void,
  ) => Map<MenuItemCategory, React.ReactNode[]>
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserContextMenu({
  userId,
  modifyMenuItems,
  popoverProps,
}: ConnectedUserContextMenuProps) {
  return (
    <Popover {...popoverProps}>
      <ConnectedUserContextMenuContents
        userId={userId}
        modifyMenuItems={modifyMenuItems}
        onDismiss={popoverProps.onDismiss}
      />
    </Popover>
  )
}

/**
 * Helper component for user context menu to make sure the hooks are only run when the menu is open.
 */
function ConnectedUserContextMenuContents({
  userId,
  modifyMenuItems,
  onDismiss,
}: Omit<ConnectedUserContextMenuProps, 'popoverProps'> & {
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(userId))

  const partyId = useAppSelector(s => s.party.current?.id)
  const partyMembers = useAppSelector(s => s.party.current?.members)
  const partyInvites = useAppSelector(s => s.party.current?.invites)
  const partyLeader = useAppSelector(s => s.party.current?.leader)

  const [relationshipKind, isOutgoing] = useAppSelector(s => {
    if (s.relationships.friends.has(userId)) {
      return [UserRelationshipKind.Friend, false]
    } else if (s.relationships.incomingRequests.has(userId)) {
      return [UserRelationshipKind.FriendRequest, false]
    } else if (s.relationships.outgoingRequests.has(userId)) {
      return [UserRelationshipKind.FriendRequest, true]
    } else if (s.relationships.blocks.has(userId)) {
      return [UserRelationshipKind.Block, false]
    } else {
      return [undefined, false]
    }
  })

  const onViewProfileClick = useStableCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  })

  const onWhisperClick = useStableCallback(() => {
    navigateToWhisper(user!.id, user!.name)
  })

  const onInviteToPartyClick = useStableCallback(() => {
    dispatch(inviteToParty({ targetId: userId }))
    onDismiss()
  })

  const onRemovePartyInvite = useStableCallback(() => {
    dispatch(removePartyInvite(partyId!, userId))
    onDismiss()
  })

  const onKickPlayerClick = useStableCallback(() => {
    dispatch(kickPlayer(partyId!, userId))
    onDismiss()
  })

  let items: Map<MenuItemCategory, React.ReactNode[]> = new Map()
  if (!user) {
    // TODO(tec27): Ideally this wouldn't have hover/focus state
    appendToMultimap(
      items,
      MenuItemCategory.General,
      <LoadingItem key='loading' text={t('users.contextMenu.loadingUsers', 'Loading user…')} />,
    )
  } else {
    appendToMultimap(
      items,
      MenuItemCategory.General,
      <MenuItem
        key='profile'
        text={t('users.contextMenu.viewProfile', 'View profile')}
        onClick={onViewProfileClick}
      />,
    )

    if (user.id !== selfUser.id) {
      if (relationshipKind !== UserRelationshipKind.Block) {
        appendToMultimap(
          items,
          MenuItemCategory.General,
          <MenuItem
            key='whisper'
            text={t('users.contextMenu.whisper', 'Whisper')}
            onClick={onWhisperClick}
          />,
        )
      }

      switch (relationshipKind) {
        case UserRelationshipKind.Friend:
          appendToMultimap(
            items,
            MenuItemCategory.General,
            <MenuItem
              key='remove-friend'
              text={t('users.contextMenu.removeFriend', 'Remove friend')}
              onClick={() => {
                dispatch(
                  removeFriend(userId, {
                    onSuccess: () => {
                      dispatch(
                        openSnackbar({
                          message: t('users.contextMenu.friendRemoved', 'Friend removed'),
                        }),
                      )
                    },
                    onError: err => {
                      dispatch(
                        openSnackbar({
                          message: userRelationshipErrorToString(
                            err,
                            t(
                              'users.errors.friendsList.errorRemovingFriend',
                              'Error removing friend',
                            ),
                            t,
                          ),
                        }),
                      )
                    },
                  }),
                )
                onDismiss()
              }}
            />,
          )
          break
        case UserRelationshipKind.FriendRequest:
          if (isOutgoing) {
            appendToMultimap(
              items,
              MenuItemCategory.General,
              <MenuItem
                key='remove-friend-request'
                text={t('users.contextMenu.removeFriendRequest', 'Remove friend request')}
                onClick={() => {
                  dispatch(
                    removeFriendRequest(userId, {
                      onSuccess: () => {
                        dispatch(
                          openSnackbar({
                            message: t(
                              'users.contextMenu.friendRequestRemoved',
                              'Friend request removed',
                            ),
                          }),
                        )
                      },
                      onError: err => {
                        dispatch(
                          openSnackbar({
                            message: userRelationshipErrorToString(
                              err,
                              t(
                                'users.errors.friendsList.errorRemovingFriendRequest',
                                'Error removing friend request',
                              ),
                              t,
                            ),
                          }),
                        )
                      },
                    }),
                  )
                  onDismiss()
                }}
              />,
            )
          } else {
            appendToMultimap(
              items,
              MenuItemCategory.General,
              <MenuItem
                key='accept-friend-request'
                text={t('users.contextMenu.addFriend', 'Add friend')}
                onClick={() => {
                  dispatch(
                    acceptFriendRequest(userId, {
                      onSuccess: () => {
                        dispatch(
                          openSnackbar({
                            message: t(
                              'users.contextMenu.friendRequestAccepted',
                              'Friend request accepted',
                            ),
                          }),
                        )
                      },
                      onError: err => {
                        dispatch(
                          openSnackbar({
                            message: userRelationshipErrorToString(
                              err,
                              t(
                                'users.errors.friendsList.errorAcceptingFriendRequest',
                                'Error accepting friend request',
                              ),
                              t,
                            ),
                          }),
                        )
                      },
                    }),
                  )
                  onDismiss()
                }}
              />,
            )
          }
          break
        case UserRelationshipKind.Block:
          appendToMultimap(
            items,
            MenuItemCategory.General,
            <MenuItem
              key='unblock'
              text={t('common.actions.unblock', 'Unblock')}
              onClick={() => {
                dispatch(
                  unblockUser(userId, {
                    onSuccess: () => {
                      dispatch(
                        openSnackbar({
                          message: t('users.contextMenu.userUnblocked', 'User unblocked'),
                        }),
                      )
                    },
                    onError: err => {
                      dispatch(
                        openSnackbar({
                          message: userRelationshipErrorToString(
                            err,
                            t(
                              'users.errors.friendsList.errorUnblockingUser',
                              'Error unblocking user',
                            ),
                            t,
                          ),
                        }),
                      )
                    },
                  }),
                )
                onDismiss()
              }}
            />,
          )
          break
        case undefined:
          appendToMultimap(
            items,
            MenuItemCategory.General,
            <MenuItem
              key='add-friend'
              text={t('users.contextMenu.addFriend', 'Add friend')}
              onClick={() => {
                dispatch(
                  sendFriendRequest(userId, {
                    onSuccess: () => {
                      dispatch(
                        openSnackbar({
                          message: t('users.contextMenu.friendRequestSent', 'Friend request sent'),
                        }),
                      )
                    },
                    onError: err => {
                      dispatch(
                        openSnackbar({
                          message: userRelationshipErrorToString(
                            err,
                            t(
                              'users.errors.friendsList.errorSendingFriendRequest',
                              'Error sending friend request',
                            ),
                            t,
                          ),
                        }),
                      )
                    },
                  }),
                )
                onDismiss()
              }}
            />,
          )
          break
        default:
          assertUnreachable(relationshipKind)
      }

      if (relationshipKind !== UserRelationshipKind.Block) {
        appendToMultimap(
          items,
          MenuItemCategory.General,
          <MenuItem
            key='block'
            text={t('common.actions.block', 'Block')}
            onClick={() => {
              dispatch(
                blockUser(userId, {
                  onSuccess: () => {
                    dispatch(
                      openSnackbar({ message: t('users.contextMenu.userBlocked', 'User blocked') }),
                    )
                  },
                  onError: err => {
                    dispatch(
                      openSnackbar({
                        message: userRelationshipErrorToString(
                          err,
                          t('users.errors.friendsList.errorBlockingUser', 'Error blocking user'),
                          t,
                        ),
                      }),
                    )
                  },
                }),
              )
              onDismiss()
            }}
          />,
        )
      }

      if (IS_ELECTRON) {
        if (!partyId && relationshipKind !== UserRelationshipKind.Block) {
          appendToMultimap(
            items,
            MenuItemCategory.Party,
            <MenuItem
              key='invite'
              text={t('users.contextMenu.inviteToParty', 'Invite to party')}
              onClick={onInviteToPartyClick}
            />,
          )
        } else if (partyLeader === selfUser.id) {
          const isAlreadyInParty = !!partyMembers?.includes(user.id)
          const hasInvite = !!partyInvites?.includes(user.id)
          if (isAlreadyInParty) {
            // TODO(2Pac): Move this item to "destructive" category, but only iside the party
            // context. And instead show "View party" or something in non-party contexts?
            appendToMultimap(
              items,
              MenuItemCategory.Party,
              <MenuItem
                key='kick-party'
                text={t('users.contextMenu.kickFromParty', 'Kick from party')}
                onClick={onKickPlayerClick}
              />,
            )
          } else if (hasInvite) {
            appendToMultimap(
              items,
              MenuItemCategory.Party,
              <MenuItem
                key='invite'
                text={t('users.contextMenu.uninviteFromParty', 'Uninvite from party')}
                onClick={onRemovePartyInvite}
              />,
            )
          } else if (relationshipKind !== UserRelationshipKind.Block) {
            appendToMultimap(
              items,
              MenuItemCategory.Party,
              <MenuItem
                key='invite'
                text={t('users.contextMenu.inviteToParty', 'Invite to party')}
                onClick={onInviteToPartyClick}
              />,
            )
          }
        }
      }
    }
  }

  if (modifyMenuItems) {
    items = modifyMenuItems(userId, items, onDismiss)
  }

  const orderedMenuItems = ALL_MENU_ITEM_CATEGORIES.reduce<React.ReactNode[]>(
    (elems, category, index) => {
      const categoryItems = items.get(category) ?? []

      if (categoryItems.length > 0 && index > 0) {
        elems.push(<Divider key={`divider-${index}`} $dense={true} />)
      }

      elems.push(...categoryItems)
      return elems
    },
    [],
  )

  return <MenuList dense={true}>{orderedMenuItems}</MenuList>
}
