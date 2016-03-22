import React from 'react'
import { Map, Range } from 'immutable'
import Lobby from '../lobby.jsx'

import { Lobby as LobbyRecord, LobbyMap, Player } from '../lobby-reducer.js'
import { User } from '../../auth/auth-records'

const PLAYERS = new Map({
  a: new Player({ name: 'tec27', id: 'a', race: 'p', slot: 0 }),
  b: new Player({ name: '2pacalypse', id: 'b', race: 't', slot: 1 }),
  c: new Player({ name: 'dronebabo', id: 'c', race: 'z', slot: 2 }),
  d: new Player({ name: 'pachi', id: 'd', race: 'r', slot: 3 }),
  e: new Player({ name: 'Heyoka', id: 'e', race: 'r', slot: 4 }),
  f: new Player({ name: 'Legionnaire', id: 'f', race: 'p', slot: 5 }),
  g: new Player({ name: 'boesthius', id: 'g', race: 't', slot: 6 }),
  h: new Player({ name: 'harem', id: 'h', race: 'z', slot: 7 }),
})

const LOBBIES = Range(2, 9).map(numSlots => {
  return new LobbyRecord({
    name: `My ${numSlots}-slot Lobby`,
    map: new LobbyMap({
      name: 'Fighting Spirit',
      hash: 'e364f0b60ea5f83c78afef5ec5a0c804d8480f1339e40ac0d8317d7a3968b5f3',
      format: 'scx',
      thumbFormat: 'jpg',
      width: 128,
      height: 128,
      tileset: 'jungle',
      description: 'sup',
    }),
    numSlots,
    players: PLAYERS.take(numSlots).toMap(),
    hostId: 'a',
  })
})

const USER = new User({ id: 27, name: 'tec27' })

export default class LobbyTest extends React.Component {
  renderLobby(lobby) {
    const containerStyle = {
      width: 400,
      height: 360,
      border: '1px solid rgba(255,255,255,0.12)',
      margin: '4px',
      overflow: 'hidden',
    }
    const scaledStyle = {
      width: 800,
      height: 720,
      transformOrigin: '0 0',
      transform: 'scale(0.5)',
    }
    return (<div key={lobby.name} style={containerStyle}>
      <div key={lobby.name} style={scaledStyle}>
        <Lobby lobby={lobby} user={USER} />
      </div>
    </div>)
  }

  render() {
    const style = {
      display: 'flex',
      flexFlow: 'row wrap',
      justifyContent: 'space-around',
      padding: 8,
    }
    return (<div style={style}>
      { LOBBIES.map(this.renderLobby) }
    </div>)
  }
}
