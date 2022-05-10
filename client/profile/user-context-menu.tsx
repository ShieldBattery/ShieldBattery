import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { Menu } from '../material/menu/menu'
import { PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorTextFaint } from '../styles/colors'
import { navigateToWhisper } from '../whispers/action-creators'
import { navigateToUserProfile } from './action-creators'

type MenuItemCategory = string
type MenuItems = Map<MenuItemCategory, React.ReactNode[]>

interface MenuStatus {
  isOpen: boolean
  onDismiss: (event?: MouseEvent) => void
}

export interface UserMenuContextValue {
  userMenuItems: Map<SbUserId, MenuItems>
  userMenuStatuses: Map<SbUserId, MenuStatus>
  updateContextMenuStatus: (
    userId: SbUserId,
    isOpen: boolean,
    onDismiss: (event?: MouseEvent) => void,
  ) => void
  replaceUserMenuItems: (userId: SbUserId, menuItems: MenuItems) => void
  appendUserMenuItems: (userId: SbUserId, menuItems: MenuItems) => void
  prependUserMenuItems: (userId: SbUserId, menuItems: MenuItems) => void
}

export const UserMenuContext = React.createContext<UserMenuContextValue>({
  userMenuItems: new Map(),
  userMenuStatuses: new Map(),
  updateContextMenuStatus: () => {},
  replaceUserMenuItems: () => {},
  appendUserMenuItems: () => {},
  prependUserMenuItems: () => {},
})

export function UserContextMenuProvider(props: { children: React.ReactNode }) {
  const [userMenuItems, setUserMenuItems] = useState<Map<SbUserId, MenuItems>>(new Map())
  const [userMenuStatuses, setUserMenuStatuses] = useState<Map<SbUserId, MenuStatus>>(new Map())

  const updateContextMenuStatus = useStableCallback(
    (userId: SbUserId, isOpen: boolean, onDismiss: () => void) => {
      console.log('updateContextMenuStatus')
      setUserMenuStatuses(new Map(userMenuStatuses).set(userId, { isOpen, onDismiss }))
    },
  )

  const replaceUserMenuItems = useStableCallback((userId: SbUserId, menuItems: MenuItems) => {
    console.log(userMenuStatuses.get(userId)?.isOpen)
    if (!userMenuStatuses.get(userId)?.isOpen) {
      return
    }

    console.log('replaceUserMenuItems')
    setUserMenuItems(userMenuItems => new Map(userMenuItems).set(userId, menuItems))
  })

  const appendUserMenuItems = useStableCallback((userId: SbUserId, menuItems: MenuItems) => {
    console.log(userMenuStatuses.get(userId)?.isOpen)
    if (!userMenuStatuses.get(userId)?.isOpen) {
      return
    }

    console.log('appendUserMenuItems')
    setUserMenuItems(userMenuItems => {
      const newMenuItems: MenuItems = userMenuItems.get(userId) ?? new Map()
      for (const [itemCategory, items] of menuItems) {
        newMenuItems.set(itemCategory, (newMenuItems.get(itemCategory) ?? []).concat(items))
      }

      return new Map(userMenuItems).set(userId, newMenuItems)
    })
  })

  const prependUserMenuItems = useStableCallback((userId: SbUserId, menuItems: MenuItems) => {
    if (!userMenuStatuses.get(userId)?.isOpen) {
      return
    }

    console.log('appendUserMenuItems')
    setUserMenuItems(userMenuItems => {
      const existingMenuItems: MenuItems = userMenuItems.get(userId) ?? new Map()
      const newMenuItems: MenuItems = new Map(menuItems)
      for (const [itemCategory, items] of existingMenuItems) {
        newMenuItems.set(itemCategory, (newMenuItems.get(itemCategory) ?? []).concat(items))
      }

      return new Map(userMenuItems).set(userId, newMenuItems)
    })
  })

  return (
    <UserMenuContext.Provider
      value={{
        userMenuItems,
        userMenuStatuses,
        updateContextMenuStatus,
        replaceUserMenuItems,
        appendUserMenuItems,
        prependUserMenuItems,
      }}>
      {props.children}
    </UserMenuContext.Provider>
  )
}

export function useUserMenuContext(): UserMenuContextValue {
  return useContext(UserMenuContext)
}

const LoadingItem = styled(MenuItem)`
  color: ${colorTextFaint};
`

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  popoverProps: Omit<PopoverProps, 'children'>
}

export function ConnectedUserContextMenu({ userId, popoverProps }: ConnectedUserContextMenuProps) {
  const dispatch = useAppDispatch()
  const selfUser = useAppSelector(s => s.auth.user)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const { userMenuItems, updateContextMenuStatus, replaceUserMenuItems } = useUserMenuContext()

  const partyId = useAppSelector(s => s.party.current?.id)
  const partyMembers = useAppSelector(s => s.party.current?.members)
  const partyInvites = useAppSelector(s => s.party.current?.invites)
  const partyLeader = useAppSelector(s => s.party.current?.leader)

  const onPopoverDismiss = popoverProps.onDismiss

  const onViewProfileClick = useCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  }, [user])

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  const onInviteToPartyClick = useCallback(() => {
    dispatch(inviteToParty({ targetId: userId }))
    onPopoverDismiss()
  }, [userId, dispatch, onPopoverDismiss])

  const onRemovePartyInvite = useCallback(() => {
    dispatch(removePartyInvite(partyId!, userId))
    onPopoverDismiss()
  }, [partyId, userId, dispatch, onPopoverDismiss])

  const onKickPlayerClick = useCallback(() => {
    dispatch(kickPlayer(partyId!, userId))
    onPopoverDismiss()
  }, [partyId, userId, dispatch, onPopoverDismiss])

  const commonActions = useMemo(() => {
    const actions: React.ReactNode[] = []
    if (!user) {
      // TODO(tec27): Ideally this wouldn't have hover/focus state
      actions.push(<LoadingItem key='loading' text='Loading user…' />)
    } else {
      actions.push(<MenuItem key='profile' text='View profile' onClick={onViewProfileClick} />)

      if (user.id !== selfUser.id) {
        actions.push(<MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />)

        if (IS_ELECTRON) {
          if (!partyId) {
            actions.push(
              <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
            )
          } else if (partyLeader === selfUser.id) {
            const isAlreadyInParty = !!partyMembers?.includes(user.id)
            const hasInvite = !!partyInvites?.includes(user.id)
            if (isAlreadyInParty) {
              actions.push(
                <MenuItem key='kick-party' text='Kick from party' onClick={onKickPlayerClick} />,
              )
            } else if (hasInvite) {
              actions.push(
                <MenuItem key='invite' text='Uninvite from party' onClick={onRemovePartyInvite} />,
              )
            } else {
              actions.push(
                <MenuItem key='invite' text='Invite to party' onClick={onInviteToPartyClick} />,
              )
            }
          }
        }
      }
    }

    return new Map([['common', actions]])
  }, [
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
  ])

  useEffect(() => {
    console.log('effect1')
    updateContextMenuStatus(userId, popoverProps.open, popoverProps.onDismiss)
  }, [popoverProps.onDismiss, popoverProps.open, updateContextMenuStatus, userId])

  useEffect(() => {
    console.log('effect2')
    replaceUserMenuItems(userId, commonActions)
  }, [commonActions, replaceUserMenuItems, userId])

  const actions = useMemo(
    () =>
      Array.from(userMenuItems.get(userId)?.values() ?? []).reduce((acc, items, index, array) => {
        acc.push(items)

        if (array.length - 1 !== index) {
          acc.push(<Divider key={`divider-${index}`} />)
        }

        return acc
      }, []),
    [userId, userMenuItems],
  )

  return (
    <Menu dense={true} {...popoverProps}>
      {actions}
    </Menu>
  )
}
