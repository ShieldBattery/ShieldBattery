import React from 'react'
import styled from 'styled-components'
import ExpandIcon from '../icons/material/expand_less_black_24px.svg'
import Logo from '../logos/logo-no-bg.svg'
import LogoText from '../logos/logotext-white-154x56.svg'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { fastOutSlowIn } from '../material/curve-constants'
import { Ripple } from '../material/ripple'
import { colorTextFaint, colorTextPrimary } from '../styles/colors'

const Container = styled.button`
  ${buttonReset};

  height: 100%;
  padding: 8px 10px 8px 8px;

  display: flex;
  align-items: center;

  color: ${colorTextFaint};
  cursor: pointer;
  -webkit-app-region: no-drag;

  --sb-ripple-color: ${colorTextPrimary};

  &:hover,
  &:active {
    color: ${colorTextPrimary};
  }
`

const SizedLogo = styled(Logo)`
  width: 56px;
  height: auto;
`

const SizedLogoText = styled(LogoText)`
  width: auto;
  height: 56px;
  margin-left: 8px;
  margin-right: 12px;
`

const AnimatedExpandIcon = styled(ExpandIcon)`
  color: inherit;
  /* NOTE(tec27): This icon points upwards and we want it pointing downward by default */
  transform: rotate(${props => (props.$flipped ? '0deg' : '180deg')});
  transition: transform 125ms ${fastOutSlowIn};
  will-change: transform;
`

export interface LockupProps {
  onClick?: (event: React.MouseEvent) => void
  menuOpened?: boolean
}

export default function Lockup({ onClick, menuOpened }: LockupProps) {
  const [buttonProps, rippleRef] = useButtonState({ onClick })

  return (
    <Container aria-label='ShieldBattery' {...buttonProps}>
      <SizedLogo />
      <SizedLogoText />
      <AnimatedExpandIcon $flipped={!!menuOpened} />
      <Ripple ref={rippleRef} />
    </Container>
  )
}
