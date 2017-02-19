import React from 'react'
import { Map } from 'immutable'
import LoadingScreen from '../loading.jsx'

import { LobbyInfo, Player } from '../lobby-reducer'
import { MapRecord as LobbyMap } from '../maps-reducer'
import { User } from '../../auth/auth-records'
import { GameStatus } from '../game-client-reducer'

const make = (state, extra) => new GameStatus({ state, extra })
const STATUSES = [
  make('unknown'),
  make('launching'),
  make('configuring'),
  make('awaitingPlayers', [ 'dronebabo', 'grnp', 'Heyoka' ]),
  make('awaitingPlayers', [ 'dronebabo', 'grnp' ]),
  make('awaitingPlayers', [ 'dronebabo' ]),
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
        statusIndex: (this.state.statusIndex + 1) % STATUSES.length
      })
    }, 2000)
  }

  componentWillUnmount() {
    this.clearInterval(this._timer)
  }

  render() {
    const lobby = new LobbyInfo({
      name: 'This is just a test',
      map: new LobbyMap({
        name: 'Fighting Spirit',
        hash: 'e364f0b60ea5f83c78afef5ec5a0c804d8480f1339e40ac0d8317d7a3968b5f3',
        format: 'scx',
        thumbFormat: 'jpg',
        width: 128,
        height: 128,
        tileset: 'jungle',
        description: 'sup',
        slots: 5,
        umsSlots: 5,
      }),
      numSlots: 5,
      players: new Map({
        a: new Player({ name: 'tec27', id: 'a', race: 'p', slot: 0 }),
        b: new Player({ name: 'dronebabo', id: 'b', race: 'r', slot: 1 }),
        c: new Player({ name: 'grnp', id: 'c', race: 'z', slot: 2 }),
        d: new Player({ name: 'Heyoka', id: 'd', race: 't', slot: 3 }),
        e: new Player({ name: 'robit', id: 'e', race: 'r', slot: 4, isComputer: true }),
      }),
      hostId: 'a',
    })
    const gameStatus = STATUSES[this.state.statusIndex]
    const user = new User({
      id: 1,
      name: 'tec27',
    })

    const containerStyle = {
      padding: 16,
    }

    return (<div style={containerStyle}>
      <p>Status: {JSON.stringify(gameStatus)}</p>
      <LoadingScreen lobby={lobby} gameStatus={gameStatus} user={user} />
    </div>)
  }
}
