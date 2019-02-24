import React from 'react'
import PropTypes from 'prop-types'
import styled, { css } from 'styled-components'

import AvatarButton from '../avatars/avatar-button.jsx'

import { Body2, singleLine } from '../styles/typography'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  height: 88px;
  padding: 16px 0px 20px 0px;
`

const StyledAvatarButton = styled(AvatarButton)`
  width: 64px;
  min-height: 64px;
`

const avatarStyle = css`
  width: 40px;
  height: 40px;

  & > svg {
    width: 40px;
    height: 40px;
  }
`

const User = styled(Body2)`
  font-size: 24px;
  margin-left: 12px;
  width: 140px;
  ${singleLine};
`

export default class ProfileNavEntry extends React.Component {
  static propTypes = {
    onProfileEntryClick: PropTypes.func.isRequired,
    avatarTitle: PropTypes.string.isRequired,
    user: PropTypes.string.isRequired,
    profileEntryRef: PropTypes.func,
  }

  render() {
    const { user, avatarTitle, onProfileEntryClick, profileEntryRef } = this.props

    return (
      <Container>
        <StyledAvatarButton
          avatarStyle={avatarStyle}
          user={user}
          title={avatarTitle}
          buttonRef={profileEntryRef}
          onClick={onProfileEntryClick}
        />
        <User>{user}</User>
      </Container>
    )
  }
}
