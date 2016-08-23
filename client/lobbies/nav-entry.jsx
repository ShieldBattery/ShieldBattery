import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'

const LobbyNavEntry = ({ lobby, currentPath, hasUnread }) =>
    <Entry link={`/lobbies/${encodeURIComponent(lobby)}`} currentPath={currentPath}
    needsAttention={hasUnread}>{lobby}</Entry>

LobbyNavEntry.propTypes = {
  lobby: PropTypes.string.isRequired,
  currentPath: PropTypes.string.isRequired,
  hasUnread: PropTypes.bool,
}

export default LobbyNavEntry
