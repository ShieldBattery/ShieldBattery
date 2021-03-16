import fs from 'fs'
import React from 'react'
import { connect } from 'react-redux'
// import styled from 'styled-components'
// import { SubheadingOld } from '../styles/typography'
import Dialog from '../material/dialog'
import FlatButton from '../material/flat-button'
import ReplayParser from 'jssuh'
import { startReplay } from './action-creators'
import RaisedButton from '../material/raised-button'
import { closeDialog } from '../dialogs/action-creators'

// TODO(coin²): Implement game type mapping in jssuh.
// This mapping is taken from my Python bot and goes from 0x00 to 0x10
const gameTypeMapping = [
  'None',
  'Custom',
  'Melee',
  'Free For All',
  'One on One',
  'Capture The Flag',
  'Greed',
  'Slaughter',
  'Sudden Death',
  'Ladder',
  'Use map settings',
  'Team Melee',
  'Team Free For All',
  'Team Capture The Flag',
  'Unknown',
  'Top vs Bottom',
  'Iron Man Ladder',
]

// TODO(coin²): Implement color mapping in jssuh (you will have to iterate through players)

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

@connect()
export default class ReplayDialog extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      replay: this.props.replay,
    }
  }

  componentDidMount() {
    console.log('componentDidMount')
    const header = this.parseReplay(this.props.replay.path)
    this.setState({ header })
  }

  parseReplay(filePath) {
    const reppi = fs.createReadStream(filePath).pipe(new ReplayParser())
    reppi.on('replayHeader', replayDetails => {
      const { players, durationFrames } = replayDetails
      const minutes = Math.floor(durationFrames / 24 / 60)
      const seconds = Math.floor(durationFrames / 24) % 60
      replayDetails.duration = `${minutes} min ${seconds} s`
      replayDetails.teams = {}
      for (const { name, id, race, team, isComputer } of players) {
        if (isComputer) {
          console.log(`Computer ${name} (${id}): Race ${race}, team ${team}`)
        } else {
          console.log(`Player ${name} (${id}): Race ${race}, team ${team}`)
        }
        if (team in replayDetails.teams) {
          replayDetails.teams[team].push(id)
        } else {
          replayDetails.teams[team] = [id]
        }
      }
      this.setState({ replayDetails })
    })
  }

  onStartReplay = replay => {
    this.props.dispatch(closeDialog())
    // NOTE(coin²): I think it's better not to close since we like to watch several replays
    // this.props.dispatch(closeOverlay()) 
    this.props.dispatch(startReplay(replay))
  }

  render() {
    const { replay, onCancel, hasButton } = this.props
    const buttons = hasButton
      ? [
          <FlatButton label={'Cancel'} key={'okay'} color={'accent'} onClick={onCancel} />,
          <RaisedButton
            key={'button'}
            onClick={() => this.onStartReplay(replay)}
            label={'Watch Replay'}
          />,
        ]
      : []

    // NOTE(coin²): Surely there are better way to do that
    // Only render content once we have replay details
    let content
    if (this.state.replayDetails !== undefined) {
      console.log('replay', replay)
      console.log('replayDetails', this.state.replayDetails)

      const {
        gameName,
        mapName,
        gameType,
        gameSubtype,
        players,
        duration,
      } = this.state.replayDetails
      content = (
        <div>
          <div>Replay date: {dateFormat.format(replay.date)}</div>
          <div>Game name: {gameName}</div>
          <div>Map name: {mapName}</div>
          <div>Game type: {gameTypeMapping[gameType]}</div>
          <div>Game subtype: {gameSubtype}</div>
          <div>Game name: {gameName}</div>
          <div>Game duration: {duration}</div>
        </div>
      )
      console.log(players)
    }

    return (
      <Dialog
        title={'Replay: ' + replay.name}
        onCancel={onCancel}
        showCloseButton={true}
        buttons={buttons}>
        {content}
      </Dialog>
    )
  }
}
