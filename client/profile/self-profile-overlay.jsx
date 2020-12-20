import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import ProfileOverlay from './profile-overlay.jsx'
import Avatar from '../avatars/avatar.jsx'
import { Title, singleLine } from '../styles/typography'

const Header = styled.div`
  position: relative;
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
  position: relative;
  padding-top: 8px;
  padding-bottom: 8px;
`

export default class SelfProfileOverlay extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
  }

  render() {
    const { user, children, ...rest } = this.props

    return (
      <ProfileOverlay
        anchorOriginVertical='bottom'
        anchorOriginHorizontal='left'
        popoverOriginVertical='bottom'
        popoverOriginHorizontal='left'
        {...rest}>
        <Header>
          <StyledAvatar user={user} />
          <Username>{user}</Username>
        </Header>
        <Actions>{children}</Actions>
      </ProfileOverlay>
    )
  }
}
