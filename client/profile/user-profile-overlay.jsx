import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import ProfileOverlay from './profile-overlay.jsx'
import Avatar from '../avatars/avatar.jsx'
import { TitleOld, singleLine } from '../styles/typography'

const Header = styled.div`
  display: flex;
  justify-content: center;
  padding-top: 12px;
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;
  margin-bottom: 8px;
`

const Username = styled(TitleOld)`
  margin-top: 0;
  margin-bottom: 0;
  padding-left: 8px;
  ${singleLine};
`

const Actions = styled.div`
  padding-top: 8px;
  padding-bottom: 8px;
`

export default class UserProfileOverlay extends React.Component {
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
      popoverOriginVertical: 'top',
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
