import fs from 'fs'

export const MIN_LENGTH_PKT_STORM =
  2 /* checksum */ +
  2 /* packet length */ +
  2 /* seq1 */ +
  2 /* seq2 */ +
  1 /* command class */ +
  1 /* command ID */ +
  1 /* player ID */ +
  1 /* flags */
export const StormPacket = {
  parse(packet) {
    const checksum = packet.readUInt16LE(0)
    const packetLength = packet.readUInt16LE(2)
    const seq1 = packet.readUInt16LE(4)
    const seq2 = packet.readUInt16LE(6)
    const commandClass = packet.readUInt8(8)
    const commandId = packet.readUInt8(9)
    const playerId = packet.readUInt8(10)
    const flags = packet.readUInt8(11)
    const packetData = packet.slice(MIN_LENGTH_PKT_STORM)

    return {
      checksum,
      packetLength,
      seq1,
      seq2,
      commandClass,
      commandId,
      playerId,
      flags,
      packetData,
    }
  },

  validate(packet) {
    return packet.length >= MIN_LENGTH_PKT_STORM
  },

  log(packet) {
    const {
      checksum,
      packetLength,
      seq1,
      seq2,
      commandClass,
      commandId,
      playerId,
      flags,
    } = StormPacket.parse(packet)

    fs.appendFileSync(
      'log.txt',
      `
      checksum - ${checksum}
      packetLength - ${packetLength}
      seq1 - ${seq1}
      seq2 - ${seq2}
      commandClass - ${commandClass}
      commandId - ${commandId}
      playerId - ${playerId}
      flags - ${flags}\n
    `,
    )
  },

  logData(packet) {
    const { packetData } = StormPacket.parse(packet)

    for (const val of packetData) {
      fs.appendFileSync('log.txt', val + ' ')
    }

    fs.appendFileSync('log.txt', '\n')
  },
}

export class BWTV {
  constructor() {
    this.packets = new Map() /* { seq1, seq2 } -> packetData */
  }

  add(packet) {
    const {
      checksum,
      packetLength,
      seq1,
      seq2,
      commandClass,
      commandId,
      playerId,
      flags,
      packetData,
    } = StormPacket.parse(packet)

    // Filter out internal Storm packets
    if (commandClass === 0) {
      return
    }

    // Filter out duplicate packets
    if (this.packets.has({ seq1, seq2 })) {
      return
    }

    this.packets.set({ seq1, seq2 }, packetData)

    fs.appendFileSync(
      'log.txt',
      `
      checksum - ${checksum}
      packetLength - ${packetLength}
      seq1 - ${seq1}
      seq2 - ${seq2}
      commandClass - ${commandClass}
      commandId - ${commandId}
      playerId - ${playerId}
      flags - ${flags}
      packetData - `,
    )

    for (const val of packetData) {
      fs.appendFileSync('log.txt', val + ' ')
    }

    fs.appendFileSync('log.txt', '\n')
  }
}
