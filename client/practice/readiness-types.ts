import type { BotRaceName } from '../../common/bots/bot-catalog'
import type { BotKey } from '../../common/bots/bot-library'
import type { BotView } from '../../common/bots/bot-view'
import type { PracticeBotRace } from '../../common/bots/practice'
import type { PoolReadiness } from '../../common/bots/practice-logic'

export type PracticeReadinessPayload =
  | { kind: 'missingRuntime'; bot: BotView; onStartWithout?: () => void }
  | {
      kind: 'incompatibleRace'
      bot: BotView
      race: PracticeBotRace
      onSetRace: (race: BotRaceName) => void
      onRemove: () => void
    }
  | { kind: 'downloading'; bot: BotView; onStartWithout?: () => void }
  | { kind: 'downloadFailed'; bot: BotView; onRemove: () => void; onStartWithout?: () => void }
  | {
      kind: 'partialLineup'
      readiness: PoolReadiness
      onStartAnyway: (dontAskAgain: boolean) => void
      onFixFirst: () => void
    }
  | {
      kind: 'nothingPlayable'
      readiness: PoolReadiness
      onDownloadMaps: () => void
      onDownloadBots: () => void
      onChangeMapPool: () => void
      onEditLineup: () => void
    }
  | {
      kind: 'problems'
      readiness: PoolReadiness
      onDownloadBots: () => void
      onEditLineup: () => void
      onChangeMapPool: () => void
      onRemoveBot: (key: BotKey) => void
      onStartWithReady: () => void
    }
