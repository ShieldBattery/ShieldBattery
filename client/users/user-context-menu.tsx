import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { appendToMultimap } from '../../common/data-structures/maps'
import { UserRelationshipKind } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
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
  color: var(--theme-on-surface-variant);
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
  const selfUser = useSelfUser()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const snackbarController = useSnackbarController()

  const relationshipKind = useAppSelector(s => {
    if (s.relationships.friends.has(userId)) {
      return UserRelationshipKind.Friend
    } else if (s.relationships.incomingRequests.has(userId)) {
      return UserRelationshipKind.FriendRequest
    } else if (s.relationships.outgoingRequests.has(userId)) {
      return UserRelationshipKind.FriendRequest
    } else if (s.relationships.blocks.has(userId)) {
      return UserRelationshipKind.Block
    } else {
      return undefined
    }
  })
  const isOutgoing = useAppSelector(s => {
    if (s.relationships.friends.has(userId)) {
      return false
    } else if (s.relationships.incomingRequests.has(userId)) {
      return false
    } else if (s.relationships.outgoingRequests.has(userId)) {
      return true
    } else if (s.relationships.blocks.has(userId)) {
      return false
    } else {
      return false
    }
  })

  const onViewProfileClick = useStableCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
    onDismiss()
  })

  const onWhisperClick = useStableCallback(() => {
    navigateToWhisper(user!.id, user!.name)
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

    if (user.id !== selfUser?.id) {
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
                      snackbarController.showSnackbar(
                        t('users.contextMenu.friendRemoved', 'Friend removed'),
                      )
                    },
                    onError: err => {
                      snackbarController.showSnackbar(
                        userRelationshipErrorToString(
                          err,
                          t(
                            'users.errors.friendsList.errorRemovingFriend',
                            'Error removing friend',
                          ),
                          t,
                        ),
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
                        snackbarController.showSnackbar(
                          t('users.contextMenu.friendRequestRemoved', 'Friend request removed'),
                        )
                      },
                      onError: err => {
                        snackbarController.showSnackbar(
                          userRelationshipErrorToString(
                            err,
                            t(
                              'users.errors.friendsList.errorRemovingFriendRequest',
                              'Error removing friend request',
                            ),
                            t,
                          ),
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
                        snackbarController.showSnackbar(
                          t('users.contextMenu.friendRequestAccepted', 'Friend request accepted'),
                        )
                      },
                      onError: err => {
                        snackbarController.showSnackbar(
                          userRelationshipErrorToString(
                            err,
                            t(
                              'users.errors.friendsList.errorAcceptingFriendRequest',
                              'Error accepting friend request',
                            ),
                            t,
                          ),
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
                      snackbarController.showSnackbar(
                        t('users.contextMenu.userUnblocked', 'User unblocked'),
                      )
                    },
                    onError: err => {
                      snackbarController.showSnackbar(
                        userRelationshipErrorToString(
                          err,
                          t(
                            'users.errors.friendsList.errorUnblockingUser',
                            'Error unblocking user',
                          ),
                          t,
                        ),
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
                      snackbarController.showSnackbar(
                        t('users.contextMenu.friendRequestSent', 'Friend request sent'),
                      )
                    },
                    onError: err => {
                      snackbarController.showSnackbar(
                        userRelationshipErrorToString(
                          err,
                          t(
                            'users.errors.friendsList.errorSendingFriendRequest',
                            'Error sending friend request',
                          ),
                          t,
                        ),
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
                    snackbarController.showSnackbar(
                      t('users.contextMenu.userBlocked', 'User blocked'),
                    )
                  },
                  onError: err => {
                    snackbarController.showSnackbar(
                      userRelationshipErrorToString(
                        err,
                        t('users.errors.friendsList.errorBlockingUser', 'Error blocking user'),
                        t,
                      ),
                    )
                  },
                }),
              )
              onDismiss()
            }}
          />,
        )
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
