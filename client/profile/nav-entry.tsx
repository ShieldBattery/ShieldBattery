import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import Avatar from '../avatars/avatar'
import ExpandIcon from '../icons/material/expand_less_black_24px.svg'
import IconButton from '../material/icon-button'
import { colorTextFaint } from '../styles/colors'
import { cabin, singleLine } from '../styles/typography'

const Container = styled.div`
  width: 100%;
  height: 72px;
  margin-top: 16px;
  padding: 0px 12px 0px 0px;

  display: flex;
  flex-direction: row;
  align-items: center;

  border-radius: 0 2px 0 0;
  cursor: pointer;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.08);
  }
`

const AvatarButton = styled(IconButton)`
  width: 64px;
  min-height: 64px;
`

const StyledAvatar = styled(Avatar)`
  width: 40px;
  height: 40px;
  display: block;
  margin: auto;
  overflow: hidden;
`

const User = styled.div`
  ${cabin}
  ${singleLine};

  width: 140px;
  margin-left: 12px;
  flex-grow: 1;

  font-size: 24px;
  font-weight: 500;
  line-height: 36px;
  letter-spacing: 0.5px;
`

const StyledExpandIcon = styled(ExpandIcon)`
  color: ${colorTextFaint};
`

export interface ProfileNavEntryProps {
  user: string
  avatarTitle: string
  onProfileEntryClick: () => void
}

const ProfileNavEntry = React.forwardRef(
  (props: ProfileNavEntryProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const { user, avatarTitle, onProfileEntryClick } = props

    return (
      <Container onClick={onProfileEntryClick}>
        <AvatarButton buttonRef={ref} title={avatarTitle} icon={<StyledAvatar user={user} />} />
        <User>{user}</User>
        <StyledExpandIcon />
      </Container>
    )
  },
)

ProfileNavEntry.propTypes = {
  onProfileEntryClick: PropTypes.func.isRequired,
  avatarTitle: PropTypes.string.isRequired,
  user: PropTypes.string.isRequired,
}

export default ProfileNavEntry
