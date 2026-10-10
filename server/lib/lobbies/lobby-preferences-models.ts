import { ReadonlyDeep } from 'type-fest'
import { GameType } from '../../../common/games/game-type'
import { LobbyVisibility } from '../../../common/lobbies'
import { SbMapId } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export interface LobbyPreferences {
  userId: SbUserId
  name?: string
  gameType?: GameType
  gameSubType?: number
  recentMaps?: SbMapId[]
  selectedMap?: SbMapId
  useLegacyLimits?: boolean
  starcraftCompatibleReplays?: boolean
  lockedAlliances?: boolean
  visibility?: LobbyVisibility
  allowObservers?: boolean
}

type DbLobbyPreferences = Dbify<LobbyPreferences>

function fromDbLobbyPreferences(prefs: DbLobbyPreferences): LobbyPreferences {
  return {
    userId: prefs.user_id,
    name: prefs.name !== null ? prefs.name : undefined,
    gameType: prefs.game_type !== null ? prefs.game_type : undefined,
    gameSubType: prefs.game_sub_type !== null ? prefs.game_sub_type : undefined,
    recentMaps: prefs.recent_maps !== null ? prefs.recent_maps : undefined,
    selectedMap: prefs.selected_map !== null ? prefs.selected_map : undefined,
    useLegacyLimits: prefs.use_legacy_limits !== null ? prefs.use_legacy_limits : undefined,
    starcraftCompatibleReplays:
      prefs.starcraft_compatible_replays !== null ? prefs.starcraft_compatible_replays : undefined,
    lockedAlliances: prefs.locked_alliances !== null ? prefs.locked_alliances : undefined,
    visibility: prefs.visibility !== null ? prefs.visibility : undefined,
    allowObservers: prefs.allow_observers !== null ? prefs.allow_observers : undefined,
  }
}

export async function upsertLobbyPreferences(
  userId: SbUserId,
  {
    name,
    gameType,
    gameSubType,
    recentMaps,
    selectedMap,
    useLegacyLimits,
    starcraftCompatibleReplays,
    lockedAlliances,
    visibility,
    allowObservers,
  }: ReadonlyDeep<Omit<LobbyPreferences, 'userId'>>,
): Promise<LobbyPreferences> {
  const { client, done } = await db()

  try {
    const result = await client.query<DbLobbyPreferences>(sql`
      INSERT INTO lobby_preferences
        (user_id, name, game_type, game_sub_type, recent_maps, selected_map, use_legacy_limits,
          starcraft_compatible_replays, locked_alliances, visibility, allow_observers)
      VALUES (${userId}, ${name}, ${gameType}, ${gameSubType}, ${recentMaps}, ${selectedMap},
        ${useLegacyLimits}, ${starcraftCompatibleReplays}, ${lockedAlliances}, ${visibility},
        ${allowObservers})
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = ${name},
        game_type = ${gameType},
        game_sub_type = ${gameSubType},
        recent_maps = ${recentMaps},
        selected_map = ${selectedMap},
        use_legacy_limits = ${useLegacyLimits},
        starcraft_compatible_replays = ${starcraftCompatibleReplays},
        locked_alliances = ${lockedAlliances},
        visibility = ${visibility},
        allow_observers = ${allowObservers}
      WHERE lobby_preferences.user_id = ${userId}
      RETURNING *;
    `)

    return fromDbLobbyPreferences(result.rows[0])
  } finally {
    done()
  }
}

export async function getLobbyPreferences(userId: SbUserId): Promise<LobbyPreferences | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbLobbyPreferences>(sql`
      SELECT *
      FROM lobby_preferences
      WHERE user_id = ${userId};
    `)
    return result.rows.length > 0 ? fromDbLobbyPreferences(result.rows[0]) : undefined
  } finally {
    done()
  }
}
