import { ReplayShieldBatteryData } from '../common/replays'
import { SbUserId } from '../common/users/sb-user'

/**
 * Parse the ShieldBattery version as it's written in the replay file. Since it's a string of 16
 * characters, it's padded by the `\u0000` character at the end, which we trim here.
 */
function parseShieldBatteryVersion(shieldBatteryVersion: string) {
  return shieldBatteryVersion.slice(0, shieldBatteryVersion.indexOf('\u0000'))
}

/**
 * Parse the game ID received as a Buffer into a string matching the UUID format, e.g.
 * "12345678-9abc-def0-1234-56789abcdef0"
 */
function parseGameId(gameId: Buffer) {
  return (
    gameId.readUint32BE(0).toString(16) +
    '-' +
    gameId.readUint16BE(4).toString(16) +
    '-' +
    gameId.readUint16BE(6).toString(16) +
    '-' +
    gameId.readUint16BE(8).toString(16) +
    '-' +
    gameId.readUint32BE(10).toString(16) +
    gameId.readUint16BE(14).toString(16)
  )
}

/**
 * Parse the user IDs received as a Buffer into an array of user IDs with a length of 8, where each
 * user ID is a 4-byte number. The order of user IDs should match the order of players in the replay
 * header.
 */
function parseUserIds(userIds: Buffer): SbUserId[] {
  const array: SbUserId[] = []
  for (let i = 0; i < 8; i++) {
    const userId = userIds.readUint32LE(i * 4) as SbUserId
    array.push(userId)
  }

  return array
}

export function parseShieldbatteryReplayData(buffer: Buffer): ReplayShieldBatteryData {
  const formatVersion = buffer.readUint16LE(0x0)
  const starcraftExeBuild = buffer.readUInt32LE(0x2)
  const shieldBatteryVersion = buffer.subarray(0x6, 0x16).toString()
  // NOTE(2Pac): We skip the 0x16 - 0x1a which is the `team_game_main_players`
  // NOTE(2Pac): We skip the 0x1a - 0x26 which is the `starting_races`
  const gameId = buffer.subarray(0x26, 0x36)
  const userIds = buffer.subarray(0x36, 0x56)
  // NOTE(2Pac): We skip the 0x56 - 0x58 which is the `game_logic_version`

  return {
    formatVersion,
    starcraftExeBuild,
    shieldBatteryVersion: parseShieldBatteryVersion(shieldBatteryVersion),
    gameId: parseGameId(gameId),
    userIds: parseUserIds(userIds),
  }
}
