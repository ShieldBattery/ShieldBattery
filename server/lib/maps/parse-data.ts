import { MapForce } from '../../../common/maps'

export interface MapParseData {
  hash: string
  title: string
  description: string
  width: number
  height: number
  tileset: number
  meleePlayers: number
  umsPlayers: number
  lobbyInitData: {
    forces: MapForce[]
  }
}
