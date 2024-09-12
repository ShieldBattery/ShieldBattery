import { MapForce } from '../../../common/maps.js'

export interface MapParseData {
  hash: string
  title: string
  description: string
  width: number
  height: number
  tileset: number
  meleePlayers: number
  umsPlayers: number
  isEud: boolean
  lobbyInitData: {
    forces: MapForce[]
  }
}
