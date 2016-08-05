import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'

const LobbyNavEntry = ({ lobby, hasUnread }) =>
    <Entry link={`/lobbies/${encodeURIComponent(lobby)}`} needsAttention={hasUnread}>{lobby}</Entry>

LobbyNavEntry.propTypes = {
  lobby: PropTypes.string.isRequired,
  hasUnread: PropTypes.bool,
}

export default LobbyNavEntry
