import React from 'react'
import { Map } from 'immutable'
import LoadingScreen from '../loading.jsx'

import { Lobby, Player } from '../lobby-reducer'
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
    const lobby = new Lobby({
      name: 'This is just a test',
      map: 'Fighting Spirit',
      numSlots: 4,
      players: new Map({
        a: new Player({ name: 'tec27', id: 'a', race: 'p', slot: 0 }),
        b: new Player({ name: 'dronebabo', id: 'b', race: 'r', slot: 1 }),
        c: new Player({ name: 'grnp', id: 'c', race: 'z', slot: 2 }),
        d: new Player({ name: 'Heyoka', id: 'd', race: 't', slot: 3 }),
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
