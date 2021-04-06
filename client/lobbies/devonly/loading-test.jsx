import React from 'react'
import { List } from 'immutable'
import LoadingScreen from '../loading'

import { LobbyInfo, Slot, Team } from '../lobby-reducer'
import { MapRecord } from '../../maps/maps-reducer'
import { SelfUserRecord } from '../../auth/auth-records'
import { GameStatus } from '../../active-game/game-client-reducer'
import { Tileset } from '../../../common/maps'

const make = (state, extra) => new GameStatus({ state, extra })
const STATUSES = [
  make('unknown'),
  make('launching'),
  make('configuring'),
  make('awaitingPlayers', ['dronebabo', 'grnp', 'Heyoka']),
  make('awaitingPlayers', ['dronebabo', 'grnp']),
  make('awaitingPlayers', ['dronebabo']),
  make('awaitingPlayers', []),
  make('starting'),
  make('playing'),
]

export default class LoadingTest extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      statusIndex: 0,
    }

    this._timer = null
  }

  componentDidMount() {
    this._timer = setInterval(() => {
      this.setState({
        statusIndex: (this.state.statusIndex + 1) % STATUSES.length,
      })
    }, 2000)
  }

  componentWillUnmount() {
    clearInterval(this._timer)
  }

  render() {
    const host = new Slot({ type: 'human', name: 'tec27', id: 'a', race: 'p' })
    const lobby = new LobbyInfo({
      name: 'This is just a test',
      map: new MapRecord({
        name: 'Fighting Spirit',
        hash: 'e364f0b60ea5f83c78afef5ec5a0c804d8480f1339e40ac0d8317d7a3968b5f3',
        format: 'scx',
        thumbFormat: 'jpg',
        width: 128,
        height: 128,
        tileset: Tileset.Jungle,
        description: 'sup',
        slots: 5,
        umsSlots: 5,
      }),
      gameType: 'melee',
      gameSubType: 0,
      teams: new List([
        new Team({
          slots: new List([
            host,
            new Slot({ type: 'human', name: 'dronebabo', id: 'b', race: 'r' }),
            new Slot({ type: 'human', name: 'grnp', id: 'c', race: 'z' }),
            new Slot({ type: 'human', name: 'Heyoka', id: 'd', race: 't' }),
            new Slot({ type: 'computer', name: 'robit', id: 'e', race: 'r' }),
          ]),
        }),
      ]),
      host: 'a',
    })
    const gameStatus = STATUSES[this.state.statusIndex]
    const user = new SelfUserRecord({
      id: 1,
      name: 'tec27',
    })

    const containerStyle = {
      padding: 16,
    }

    return (
      <div style={containerStyle}>
        <p>Status: {JSON.stringify(gameStatus)}</p>
        <LoadingScreen lobby={lobby} gameStatus={gameStatus} user={user} />
      </div>
    )
  }
}
