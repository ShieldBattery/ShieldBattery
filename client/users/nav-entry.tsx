import PropTypes from 'prop-types'
import React from 'react'
import { styled } from 'styled-components'
import { Avatar } from '../avatars/avatar.js'
import { buttonReset } from '../material/button-reset.js'
import { useButtonState } from '../material/button.js'
import { Ripple } from '../material/ripple.js'
import { AnimatedExpandIcon } from '../styles/animated-expand-icon.js'
import { colorTextFaint, colorTextPrimary } from '../styles/colors.js'
import { cabin, singleLine } from '../styles/typography.js'

const Container = styled.button`
  ${buttonReset};
  width: 100%;
  height: 72px;
  margin-top: 16px;
  padding: 0px 12px 0px 16px;

  display: flex;
  flex-direction: row;
  align-items: center;

  border-radius: 0 2px 0 0;
  cursor: pointer;
  text-align: left;

  & ${AnimatedExpandIcon} {
    color: ${colorTextFaint};
  }

  &:hover,
  &:active {
    & ${AnimatedExpandIcon} {
      color: ${colorTextPrimary};
    }
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

export interface ProfileNavEntryProps {
  user: string
  onProfileEntryClick: (event: React.MouseEvent) => void
  profileMenuOpen: boolean
}

const ProfileNavEntry = React.forwardRef(
  (
    { user, onProfileEntryClick, profileMenuOpen }: ProfileNavEntryProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const [buttonProps, rippleRef] = useButtonState({ onClick: onProfileEntryClick })

    return (
      <Container ref={ref} {...buttonProps}>
        <StyledAvatar user={user} />
        <User>{user}</User>
        <AnimatedExpandIcon $pointUp={!profileMenuOpen} />
        <Ripple ref={rippleRef} />
      </Container>
    )
  },
)

ProfileNavEntry.propTypes = {
  onProfileEntryClick: PropTypes.func.isRequired,
  user: PropTypes.string.isRequired,
}

export default ProfileNavEntry
