import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import CloseLobbyIcon from '../icons/material/ic_close_black_24px.svg'
import IconButton from '../material/icon-button'
import Entry from '../material/left-nav/entry'

const LeaveButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
  line-height: 32px;
  margin-right: 4px;

  > span {
    line-height: 32px;
  }
`

const LobbyNavEntry = ({ lobby, currentPath, hasUnread, onLeaveClick }) => {
  const button = (
    <LeaveButton icon={<CloseLobbyIcon />} title='Leave lobby' onClick={onLeaveClick} />
  )
  return (
    <Entry
      link={`/lobbies/${encodeURIComponent(lobby)}`}
      currentPath={currentPath}
      needsAttention={hasUnread}
      button={button}>
      {lobby}
    </Entry>
  )
}

LobbyNavEntry.propTypes = {
  lobby: PropTypes.string.isRequired,
  currentPath: PropTypes.string.isRequired,
  onLeaveClick: PropTypes.func.isRequired,
  hasUnread: PropTypes.bool,
}

export default LobbyNavEntry
