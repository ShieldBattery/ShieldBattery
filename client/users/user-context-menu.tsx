import React, { useMemo } from 'react'
import styled from 'styled-components'
import { appendToMultimap } from '../../common/data-structures/maps'
import { SbUserId } from '../../common/users/sb-user'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorTextFaint } from '../styles/colors'
import { navigateToWhisper } from '../whispers/action-creators'
import { navigateToUserProfile } from './action-creators'

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
  // TODO(2Pac): Create a "destructive" menu item for this category, in red-ish color or something?
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
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(userId))

  const partyId = useAppSelector(s => s.party.current?.id)
  const partyMembers = useAppSelector(s => s.party.current?.members)
  const partyInvites = useAppSelector(s => s.party.current?.invites)
  const partyLeader = useAppSelector(s => s.party.current?.leader)

  const onViewProfileClick = useStableCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  })

  const onWhisperClick = useStableCallback(() => {
    navigateToWhisper(user!.name)
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

  const items = useMemo(() => {
    let items: Map<MenuItemCategory, React.ReactNode[]> = new Map()
    if (!user) {
      // TODO(tec27): Ideally this wouldn't have hover/focus state
      appendToMultimap(
        items,
        MenuItemCategory.General,
        <LoadingItem key='loading' text='Loading user…' />,
      )
    } else {
      appendToMultimap(
        items,
        MenuItemCategory.General,
        <MenuItem key='profile' text='View profile' onClick={onViewProfileClick} />,
      )

      if (user.id !== selfUser.id) {
        appendToMultimap(
          items,
          MenuItemCategory.General,
          <MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />,
        )

        if (IS_ELECTRON) {
          if (!partyId) {
            appendToMultimap(
              items,
              MenuItemCategory.Party,
              <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
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
                <MenuItem key='kick-party' text='Kick from party' onClick={onKickPlayerClick} />,
              )
            } else if (hasInvite) {
              appendToMultimap(
                items,
                MenuItemCategory.Party,
                <MenuItem key='invite' text='Uninvite from party' onClick={onRemovePartyInvite} />,
              )
            } else {
              appendToMultimap(
                items,
                MenuItemCategory.Party,
                <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
              )
            }
          }
        }
      }
    }

    if (modifyMenuItems) {
      items = modifyMenuItems(userId, items, onDismiss)
    }

    return items
  }, [
    modifyMenuItems,
    onDismiss,
    onInviteToPartyClick,
    onKickPlayerClick,
    onRemovePartyInvite,
    onViewProfileClick,
    onWhisperClick,
    partyId,
    partyInvites,
    partyLeader,
    partyMembers,
    selfUser.id,
    user,
    userId,
  ])

  const orderedMenuItems = useMemo(() => {
    return ALL_MENU_ITEM_CATEGORIES.reduce<React.ReactNode[]>((elems, category, index) => {
      const categoryItems = items.get(category) ?? []

      if (categoryItems.length > 0 && index > 0) {
        elems.push(<Divider key={`divider-${index}`} />)
      }

      elems.push(...categoryItems)
      return elems
    }, [])
  }, [items])

  return <MenuList dense={true}>{orderedMenuItems}</MenuList>
}
