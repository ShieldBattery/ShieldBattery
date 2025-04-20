import React, { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { appendToMultimap, cloneMultimap, mergeMultimaps } from '../../common/data-structures/maps'
import { UserRelationshipKind } from '../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'
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

/**
 * Props passed to the component that customizes/displays context menu items for a user.
 */
export interface UserMenuProps {
  /** The user this context menu is for. */
  userId: SbUserId
  /**
   * The base items in the context menu. All of these items should be displayed to the user, but
   * more can be added as well.
   */
  items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
  /**
   * An event handler that will be called when the menu closes.
   */
  onMenuClose: (event?: MouseEvent) => void

  /**
   * Component type to use to render the menu items in the `UserMenuItemsComponent`.
   */
  MenuComponent: React.ComponentType<{
    items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
    userId: SbUserId
    onMenuClose: (event?: MouseEvent) => void
  }>
}

export type UserMenuComponent = React.ComponentType<UserMenuProps>

export interface UserMenuContextValue {
  userId: SbUserId
  onMenuClose: (event?: MouseEvent) => void
}

export const UserMenuContext = React.createContext<UserMenuContextValue>({
  userId: makeSbUserId(0),
  onMenuClose: () => {},
})

export function DefaultUserMenu({ items, MenuComponent, userId, onMenuClose }: UserMenuProps) {
  return <MenuComponent items={items} userId={userId} onMenuClose={onMenuClose} />
}

/** Context that provides user context menu items for every menu within an area. */
const BaseUserMenuItemsContext = React.createContext<{
  items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
}>({ items: new Map() })

/**
 * Provider for user context menu items for every menu within an area. Items in this provider will
 * be merged with any items from its ancestors.
 */
export function BaseUserMenuItemsProvider({
  items,
  children,
}: {
  items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
  children: React.ReactNode
}) {
  const baseItems = useBaseUserMenuItems()
  const mergedItems = mergeMultimaps(baseItems, items)

  return (
    <BaseUserMenuItemsContext.Provider value={{ items: mergedItems }}>
      {children}
    </BaseUserMenuItemsContext.Provider>
  )
}

/**
 * Hook that returns the base user context menu items for the current area.
 */
export function useBaseUserMenuItems() {
  return useContext(BaseUserMenuItemsContext).items
}

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  /**
   * An optional component that will be used for rendering menu items. This component can modify
   * the menu items given before passing them for rendering.
   */
  UserMenu?: UserMenuComponent
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserContextMenu({
  userId,
  UserMenu,
  popoverProps,
}: ConnectedUserContextMenuProps) {
  return (
    <Popover {...popoverProps}>
      <ConnectedUserContextMenuContents
        userId={userId}
        UserMenu={UserMenu}
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
  UserMenu = DefaultUserMenu,
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

  const baseItems = useBaseUserMenuItems()
  const items: Map<MenuItemCategory, React.ReactNode[]> = cloneMultimap(baseItems)
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
        onClick={() => {
          navigateToUserProfile(user!.id, user!.name)
          onDismiss()
        }}
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
            onClick={() => {
              navigateToWhisper(user!.id, user!.name)
              onDismiss()
            }}
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

  return (
    <UserMenu
      MenuComponent={UserContextMenuList}
      items={items}
      userId={userId}
      onMenuClose={onDismiss}
    />
  )
}

function UserContextMenuList({
  items,
  userId,
  onMenuClose,
}: {
  items: ReadonlyMap<MenuItemCategory, React.ReactNode[]>
  userId: SbUserId
  onMenuClose: (event?: MouseEvent) => void
}) {
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

  return (
    <UserMenuContext.Provider value={{ userId, onMenuClose }}>
      <MenuList dense={true}>{orderedMenuItems}</MenuList>
    </UserMenuContext.Provider>
  )
}
