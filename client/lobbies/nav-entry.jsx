import React, { PropTypes } from 'react'
import Entry from '../material/left-nav/entry.jsx'
import IconButton from '../material/icon-button.jsx'
import styles from './nav-entry.css'

const LobbyNavEntry = ({ lobby, currentPath, hasUnread, onLeaveClick }) => {
  const button = <IconButton className={styles.leaveButton}
      icon='close' title='Leave lobby' onClick={onLeaveClick}/>
  return (
    <Entry link={`/lobbies/${encodeURIComponent(lobby)}`}
        currentPath={currentPath}
        needsAttention={hasUnread}
        button={button}>{lobby}</Entry>
  )
}

LobbyNavEntry.propTypes = {
  lobby: PropTypes.string.isRequired,
  currentPath: PropTypes.string.isRequired,
  onLeaveClick: PropTypes.func.isRequired,
  hasUnread: PropTypes.bool,
}

export default LobbyNavEntry
