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
 * plus (in the Electron app, when a replay is available) "Watch replay" and "Save replay".
 *
 * Split out from its callers so `useGameReplayActions` (which subscribes to this game's replay
 * info) only runs while the menu is actually open, rather than for every row on every render.
 */
export function GameContextMenuContent({
  game,
  onDismiss,
}: {
  game: ReadonlyDeep<GameRecordJson>
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { replayInfo, onWatchReplay, onSaveReplay } = useGameReplayActions(game)

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

  if (IS_ELECTRON && replayInfo) {
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
        onClick={() => {
          onDismiss()
          onSaveReplay()
        }}
      />,
    )
  }

  return <MenuList dense={true}>{items}</MenuList>
}
