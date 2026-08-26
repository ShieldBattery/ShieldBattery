import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson } from '../../common/games/games'
import { MaterialIcon } from '../icons/material/material-icon'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { navigateToGameResults } from './action-creators'
import { useGameReplayActions } from './use-game-replay-actions'

/**
 * The row context menu shared by the games list and match history pages: "View full results",
 * plus a replay action when one is available -- in the Electron app, "Watch replay" and a
 * "Save replay" item that opens the destination menu (owned by the caller, anchored at this same
 * menu's position); on web, a "Download replay" item instead.
 *
 * Split out from its callers so `useGameReplayActions` (which subscribes to this game's replay
 * info) only runs while the menu is actually open, rather than for every row on every render.
 */
export function GameContextMenuContent({
  game,
  onDismiss,
  onOpenSaveMenu,
}: {
  game: ReadonlyDeep<GameRecordJson>
  onDismiss: () => void
  /** Opens the "Save replay" destination menu, anchored at this menu's position (Electron only). */
  onOpenSaveMenu: (event: React.MouseEvent | KeyboardEvent) => void
}) {
  const { t } = useTranslation()
  const { replayInfo, onWatchReplay } = useGameReplayActions(game)

  // Built as a flat array (rather than a conditional fragment) so every item stays a direct
  // child of `MenuList`: it only clones `dense`/focus state onto, and lets arrow-key navigation
  // reach, its direct `MenuItem` children.
  const items: React.ReactNode[] = [
    <MenuItem
      key='view-full-results'
      icon={<MaterialIcon icon='open_in_new' />}
      text={t('games.sidePanel.viewFullResults', 'View full results')}
      onClick={() => {
        onDismiss()
        navigateToGameResults(game.id)
      }}
    />,
  ]

  if (replayInfo && IS_ELECTRON) {
    items.push(
      <Divider key='divider' $dense={true} />,
      <MenuItem
        key='watch-replay'
        icon={<MaterialIcon icon='play_arrow' />}
        text={t('gameDetails.buttonWatchReplay', 'Watch replay')}
        onClick={() => {
          onDismiss()
          onWatchReplay()
        }}
      />,
      <MenuItem
        key='save-replay'
        icon={<MaterialIcon icon='save' />}
        text={t('gameDetails.buttonSaveReplay', 'Save replay')}
        onClick={event => {
          onDismiss()
          onOpenSaveMenu(event)
        }}
      />,
    )
  } else if (replayInfo) {
    items.push(
      <Divider key='divider' $dense={true} />,
      <MenuItem
        key='download-replay'
        icon={<MaterialIcon icon='download' />}
        text={t('gameDetails.buttonDownloadReplay', 'Download replay')}
        onClick={() => {
          onDismiss()
          const a = document.createElement('a')
          a.href = replayInfo.url
          a.target = '_blank'
          a.click()
        }}
      />,
    )
  }

  return <MenuList dense={true}>{items}</MenuList>
}
