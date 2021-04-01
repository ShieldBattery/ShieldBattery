import React from 'react'
import styled from 'styled-components'
import ExpandIcon from '../icons/material/expand_less_black_24px.svg'
import Logo from '../logos/logo-no-bg.svg'
import LogoText from '../logos/logotext-white-154x56.svg'
import { fastOutSlowIn } from '../material/curve-constants'
import { colorTextFaint, colorTextPrimary } from '../styles/colors'

const Container = styled.div`
  height: 100%;
  padding: 8px 0px 8px 8px;

  display: flex;
  align-items: center;

  color: ${colorTextFaint};
  cursor: pointer;
  -webkit-app-region: no-drag;

  &:hover,
  &:active {
    background-color: rgba(255, 255, 255, 0.04);
    color: ${colorTextPrimary};
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.08);
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
  margin-right: 8px;
`

const AnimatedExpandIcon = styled(ExpandIcon)`
  color: inherit;
  /* NOTE(tec27): This icon points upwards and we want it pointing downward by default */
  transform: rotate(${props => (props.$flipped ? '0deg' : '180deg')});
  transition: transform 125ms ${fastOutSlowIn};
  will-change: transform;
`

export default function Lockup(props: {
  onClick?: (event: React.MouseEvent) => void
  menuOpened?: boolean
}) {
  return (
    <Container aria-label='ShieldBattery' onClick={props.onClick}>
      <SizedLogo />
      <SizedLogoText />
      <AnimatedExpandIcon $flipped={!!props.menuOpened} />
    </Container>
  )
}
