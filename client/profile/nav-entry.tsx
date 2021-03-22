import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import Avatar from '../avatars/avatar'
import ExpandIcon from '../icons/material/expand_less_black_24px.svg'
import { colorTextFaint } from '../styles/colors'
import { cabin, singleLine } from '../styles/typography'

const Container = styled.div`
  width: 100%;
  height: 72px;
  margin-top: 16px;
  padding: 0px 12px 0px 16px;

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
  margin-left: 16px;
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
  onProfileEntryClick: () => void
}

const ProfileNavEntry = React.forwardRef(
  (
    { user, onProfileEntryClick }: ProfileNavEntryProps,
    ref: React.ForwardedRef<HTMLDivElement>,
  ) => {
    return (
      <Container ref={ref} onClick={onProfileEntryClick}>
        <StyledAvatar user={user} />
        <User>{user}</User>
        <StyledExpandIcon />
      </Container>
    )
  },
)

ProfileNavEntry.propTypes = {
  onProfileEntryClick: PropTypes.func.isRequired,
  user: PropTypes.string.isRequired,
}

export default ProfileNavEntry
