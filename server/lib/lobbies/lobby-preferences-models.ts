import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export interface LobbyPreferences {
  userId: SbUserId
  name?: string
  gameType?: number
  gameSubType?: number
  recentMaps?: string[]
  selectedMap?: string
  turnRate?: number
  useLegacyLimits?: boolean
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
    turnRate: prefs.turn_rate !== null ? prefs.turn_rate : undefined,
    useLegacyLimits: prefs.use_legacy_limits !== null ? prefs.use_legacy_limits : undefined,
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
    turnRate,
    useLegacyLimits,
  }: ReadonlyDeep<LobbyPreferences>,
): Promise<LobbyPreferences> {
  const { client, done } = await db()

  try {
    const result = await client.query<DbLobbyPreferences>(sql`
      INSERT INTO lobby_preferences
        (user_id, name, game_type, game_sub_type, recent_maps, selected_map, turn_rate,
          use_legacy_limits)
      VALUES (${userId}, ${name}, ${gameType}, ${gameSubType}, ${recentMaps}, ${selectedMap},
        ${turnRate}, ${useLegacyLimits})
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = ${name},
        game_type = ${gameType},
        game_sub_type = ${gameSubType},
        recent_maps = ${recentMaps},
        selected_map = ${selectedMap},
        turn_rate = ${turnRate},
        use_legacy_limits = ${useLegacyLimits}
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
