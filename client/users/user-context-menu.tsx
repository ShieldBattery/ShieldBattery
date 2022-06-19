import React, { useCallback } from 'react'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, PopoverProps } from '../material/popover'
import { inviteToParty, kickPlayer, removePartyInvite } from '../parties/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorTextFaint } from '../styles/colors'
import { navigateToWhisper } from '../whispers/action-creators'
import { navigateToUserProfile } from './action-creators'

const LoadingItem = styled(MenuItem)`
  color: ${colorTextFaint};
`

export interface ConnectedUserContextMenuProps {
  userId: SbUserId
  /**
   * An optional function that will be called when rendering menu items. If provided, the value
   * returned from this function will be used as the `children` of the menu. Mutating the input
   * value and returning it is okay.
   */
  modifyMenuItems?: (
    userId: SbUserId,
    items: React.ReactNode[],
    onMenuClose: (event?: MouseEvent) => void,
  ) => React.ReactNode[]
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

  const onViewProfileClick = useCallback(() => {
    navigateToUserProfile(user!.id, user!.name)
  }, [user])

  const onWhisperClick = useCallback(() => {
    navigateToWhisper(user!.name)
  }, [user])

  const onInviteToPartyClick = useCallback(() => {
    dispatch(inviteToParty({ targetId: userId }))
    onDismiss()
  }, [userId, dispatch, onDismiss])

  const onRemovePartyInvite = useCallback(() => {
    dispatch(removePartyInvite(partyId!, userId))
    onDismiss()
  }, [partyId, userId, dispatch, onDismiss])

  const onKickPlayerClick = useCallback(() => {
    dispatch(kickPlayer(partyId!, userId))
    onDismiss()
  }, [partyId, userId, dispatch, onDismiss])

  let actions: React.ReactNode[] = []
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

  if (modifyMenuItems) {
    actions = modifyMenuItems(userId, actions, onDismiss)
  }

  return <MenuList dense={true}>{actions}</MenuList>
}
