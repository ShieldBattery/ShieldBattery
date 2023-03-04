import React from 'react'
import styled from 'styled-components'
import Logo from '../logos/logo-no-bg.svg'
import LogoText from '../logos/logotext-white-154x56.svg'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { AnimatedExpandIcon } from '../styles/animated-expand-icon'
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

export interface LockupProps {
  onClick?: (event: React.MouseEvent) => void
  menuOpened?: boolean
}

export const Lockup = React.forwardRef(
  ({ onClick, menuOpened }: LockupProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const [buttonProps, rippleRef] = useButtonState({ onClick })

    return (
      <Container ref={ref} aria-label='ShieldBattery' {...buttonProps}>
        <SizedLogo />
        <SizedLogoText />
        <AnimatedExpandIcon $pointUp={!!menuOpened} />
        <Ripple ref={rippleRef} />
      </Container>
    )
  },
)

export default Lockup
