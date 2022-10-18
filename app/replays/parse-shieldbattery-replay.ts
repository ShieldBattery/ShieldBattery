import { ReplayShieldBatteryData } from '../../common/replays'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user'

/**
 * Parse the ShieldBattery version as it's written in the replay file. Since it's a string of 16
 * characters, it's padded by the `\u0000` character at the end, which we trim here.
 */
function parseShieldBatteryVersion(shieldBatteryVersion: string) {
  return shieldBatteryVersion.split('\u0000', 1)[0]
}

/**
 * Parse the game ID received as a Buffer into a string matching the UUID format, e.g.
 * "12345678-9abc-def0-1234-56789abcdef0"
 */
export function parseGameId(gameId: Buffer) {
  return (
    gameId.readUint32BE(0).toString(16).padStart(8, '0') +
    '-' +
    gameId.readUint16BE(4).toString(16).padStart(4, '0') +
    '-' +
    gameId.readUint16BE(6).toString(16).padStart(4, '0') +
    '-' +
    gameId.readUint16BE(8).toString(16).padStart(4, '0') +
    '-' +
    gameId.readUint32BE(10).toString(16).padStart(8, '0') +
    gameId.readUint16BE(14).toString(16).padStart(4, '0')
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
    const userId = makeSbUserId(userIds.readUint32LE(i * 4))
    array.push(userId)
  }

  return array
}

export function parseShieldbatteryReplayData(buffer: Buffer): ReplayShieldBatteryData {
  // 0x56 bytes is the size of the first version of our replay data, so anything above that is fine.
  if (buffer.length < 0x56) {
    throw new Error(`The replay's ShieldBattery data section size is invalid: ${buffer.length}`)
  }

  const formatVersion = buffer.readUint16LE(0x0)
  const data = { formatVersion } as ReplayShieldBatteryData

  if (formatVersion >= 0) {
    data.starcraftExeBuild = buffer.readUInt32LE(0x2)
    data.shieldBatteryVersion = parseShieldBatteryVersion(buffer.subarray(0x6, 0x16).toString())
    // NOTE(2Pac): We skip the 0x16 - 0x1a which is the `team_game_main_players`
    // NOTE(2Pac): We skip the 0x1a - 0x26 which is the `starting_races`
    data.gameId = parseGameId(buffer.subarray(0x26, 0x36))
    data.userIds = parseUserIds(buffer.subarray(0x36, 0x56))
  }
  if (formatVersion >= 1) {
    // NOTE(2Pac): We skip the 0x56 - 0x58 which is the `game_logic_version`
  }

  return data
}
