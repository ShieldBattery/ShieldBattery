import React from 'react'
import PropTypes from 'prop-types'
import styled, { css } from 'styled-components'

import AvatarButton from '../avatars/avatar-button.jsx'

import { Body2, singleLine, robotoCondensed } from '../styles/typography.ts'

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  height: 88px;
  padding: 16px 12px 0px 0px;
`

const StyledAvatarButton = styled(AvatarButton)`
  width: 64px;
  min-height: 64px;
`

const avatarStyle = css`
  width: 40px;
  height: 40px;
`

const User = styled(Body2)`
  ${robotoCondensed}
  font-size: 24px;
  font-weight: 700;
  margin-left: 12px;
  width: 140px;
  ${singleLine};
`

// TODO(tec27): Make this whole area clickable/hoverable
const ProfileNavEntry = React.forwardRef((props, ref) => {
  const { user, avatarTitle, onProfileEntryClick } = props

  return (
    <Container>
      <StyledAvatarButton
        avatarStyle={avatarStyle}
        user={user}
        title={avatarTitle}
        buttonRef={ref}
        onClick={onProfileEntryClick}
      />
      <User>{user}</User>
    </Container>
  )
})

ProfileNavEntry.propTypes = {
  onProfileEntryClick: PropTypes.func.isRequired,
  avatarTitle: PropTypes.string.isRequired,
  user: PropTypes.string.isRequired,
}

export default ProfileNavEntry
