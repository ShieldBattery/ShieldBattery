import React from 'react'
import PropTypes from 'prop-types'
import CloseLobbyIcon from '../icons/material/ic_close_black_24px.svg'
import Entry from '../material/left-nav/entry.jsx'
import IconButton from '../material/icon-button.jsx'
import styles from './nav-entry.css'

const LobbyNavEntry = ({ lobby, currentPath, hasUnread, onLeaveClick }) => {
  const button = <IconButton className={styles.leaveButton}
    icon={<CloseLobbyIcon />} title='Leave lobby' onClick={onLeaveClick}/>
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
