import { GameSource } from '../../../common/games/configuration'
import { GameRecord } from '../../../common/games/games'
import { MatchmakingType } from '../../../common/matchmaking'

const MAX_MAP_NAME_LENGTH = 20

/**
 * Generates a concise filename for a replay download.
 *
 * Format: SB-<gameType>-<mapName>-<timestamp>
 *
 * Examples:
 * - "SB-1v1-Fighting_Spirit-1703692800"
 * - "SB-2v2-Neo_Sylphid-1703692800"
 * - "SB-Lobby-Fastest_Map_Ever_M-1703692800" (truncated)
 */
export function generateReplayFilename(game: GameRecord, mapName: string): string {
  const gameTypeLabel = getGameTypeLabel(game)
  const sanitizedMapName = sanitizeAndTruncateMapName(mapName)
  const timestamp = Math.floor(game.startTime.getTime() / 1000)

  return `SB-${gameTypeLabel}-${sanitizedMapName}-${timestamp}`
}

function getGameTypeLabel(game: GameRecord): string {
  if (game.config.gameSource === GameSource.Matchmaking) {
    const extra = game.config.gameSourceExtra
    switch (extra.type) {
      case MatchmakingType.Match1v1:
        return '1v1'
      case MatchmakingType.Match1v1Fastest:
        return '1v1F'
      case MatchmakingType.Match2v2:
        return '2v2'
      default:
        return 'Ranked'
    }
  }
  return 'Lobby'
}

function sanitizeAndTruncateMapName(mapName: string): string {
  // Remove problematic characters:
  // - Control characters (0x00-0x1F) - includes StarCraft color codes
  // - Windows forbidden filename characters: < > : " / \ | ? *
  // - Replace spaces/whitespace with underscores
  const sanitized = mapName
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .trim()

  // Truncate if too long
  if (sanitized.length > MAX_MAP_NAME_LENGTH) {
    return sanitized.slice(0, MAX_MAP_NAME_LENGTH).replace(/_$/, '')
  }

  return sanitized
}
