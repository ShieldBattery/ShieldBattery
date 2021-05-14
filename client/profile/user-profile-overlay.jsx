import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import Avatar from '../avatars/avatar'
import { headline6, singleLine } from '../styles/typography'
import ProfileOverlay from './profile-overlay'

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

const Username = styled.div`
  ${headline6};
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
      anchorOffsetHorizontal: -4,
      anchorOriginVertical: 'top',
      anchorOriginHorizontal: 'left',
      popoverOriginVertical: 'top',
      popoverOriginHorizontal: 'right',
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
