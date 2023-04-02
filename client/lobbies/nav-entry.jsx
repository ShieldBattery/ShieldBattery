import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import CloseLobbyIcon from '../icons/material/close-24px.svg'
import { IconButton } from '../material/button'
import Entry from '../material/left-nav/entry'
import { useTranslation } from 'react-i18next'

const LeaveButton = styled(IconButton)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 6px 4px;
  margin-right: 4px;
`
const { t } = useTranslation()
const LobbyNavEntry = ({ lobby, currentPath, hasUnread, onLeaveClick }) => {
  const button = (
    <LeaveButton icon={<CloseLobbyIcon />} title={t('lobbies.navEntry.leaveLobbyLabel', 'Leave lobby')} onClick={onLeaveClick} />
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
