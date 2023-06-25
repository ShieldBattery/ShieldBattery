import PropTypes from 'prop-types'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`

const LobbyNavEntry = ({ lobby, currentPath, hasUnread, onLeaveClick }) => {
  const { t } = useTranslation()
  const button = (
    <LeaveButton
      icon={<MaterialIcon icon='close' />}
      title={t('lobbies.lobby.leaveLobby', 'Leave lobby')}
      onClick={onLeaveClick}
    />
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
