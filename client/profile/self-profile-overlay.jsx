import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import ProfileOverlay from './profile-overlay.jsx'
import Avatar from '../avatars/avatar.jsx'
import { Title, singleLine } from '../styles/typography'

const Header = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 24px;
`

const StyledAvatar = styled(Avatar)`
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
`

const Username = styled(Title)`
  margin-top: 0;
  margin-bottom: 0;
  ${singleLine};
`

const Actions = styled.div`
  padding-top: 8px;
  padding-bottom: 8px;
`

export default class SelfProfileOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    user: PropTypes.string.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  render() {
    const { user, children, open, onDismiss, anchor } = this.props
    const popoverProps = {
      open,
      onDismiss,
      anchor,
      anchorOriginVertical: 'bottom',
      anchorOriginHorizontal: 'left',
      popoverOriginVertical: 'bottom',
      popoverOriginHorizontal: 'left',
    }

    return (
      <ProfileOverlay popoverProps={popoverProps}>
        <Header>
          <StyledAvatar user={user} />
          <Username>{user}</Username>
        </Header>
        <Actions>{children}</Actions>
      </ProfileOverlay>
    )
  }
}
