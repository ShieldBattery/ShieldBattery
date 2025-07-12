import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { appendToMultimap } from '../../common/data-structures/maps'
import { findSlotByUserId } from '../../common/lobbies'
import { DestructiveMenuItem } from '../material/menu/item'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { MenuItemCategory, UserMenuProps } from '../users/user-context-menu'
import { banPlayer, kickPlayer } from './action-creators'
import { LobbyContext } from './lobby-context'

export function LobbyUserMenu({ userId, items, onMenuClose, MenuComponent }: UserMenuProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUserId = useAppSelector(s => s.auth.self!.user.id)
  const user = useAppSelector(s => s.users.byId.get(userId))
  const { lobby } = useContext(LobbyContext)
  const [, , slot] = findSlotByUserId(lobby, userId)

  const isHost = lobby.host.userId === selfUserId
  const isSelf = user?.id === selfUserId

  const menuItems = new Map(items)
  if (user && slot && !isSelf && isHost) {
    appendToMultimap(
      menuItems,
      MenuItemCategory.Destructive,
      <DestructiveMenuItem
        key='kick'
        text={t('lobbies.slots.kickPlayer', {
          defaultValue: 'Kick {{user}}',
          user: user.name,
        })}
        onClick={() => {
          dispatch(kickPlayer(slot.id))
          onMenuClose()
        }}
      />,
    )
    appendToMultimap(
      menuItems,
      MenuItemCategory.Destructive,
      <DestructiveMenuItem
        key='ban'
        text={t('lobbies.slots.banPlayer', {
          defaultValue: 'Ban {{user}}',
          user: user.name,
        })}
        onClick={() => {
          dispatch(banPlayer(slot.id))
          onMenuClose()
        }}
      />,
    )
  }

  return <MenuComponent items={menuItems} userId={userId} onMenuClose={onMenuClose} />
}
