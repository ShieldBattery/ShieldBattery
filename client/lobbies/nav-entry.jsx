import React from 'react'
import Entry from '../material/left-nav/entry.jsx'

const LobbyNavEntry =
    ({lobby}) => <Entry link={`/lobbies/${encodeURIComponent(lobby)}`}>{lobby}</Entry>

LobbyNavEntry.propTypes = {
  lobby: React.PropTypes.string.isRequired,
}

export default LobbyNavEntry
