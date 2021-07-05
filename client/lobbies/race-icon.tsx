import React from 'react'
import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import RandomIcon from '../icons/material/ic_casino_black_24px.svg'
import ZergIcon from '../icons/starcraft/hydra_24px.svg'
import TerranIcon from '../icons/starcraft/marine_24px.svg'
import ProtossIcon from '../icons/starcraft/zealot_24px.svg'
import { getRaceColor } from '../styles/colors'

const ICONS: Record<RaceChar, React.ComponentType<any>> = {
  r: RandomIcon,
  p: ProtossIcon,
  t: TerranIcon,
  z: ZergIcon,
}

const StyledIcon = styled.svg<{ $race: RaceChar }>`
  fill: ${props => getRaceColor(props.$race)};
`

export interface RaceIconProps {
  race: RaceChar
  className?: string
  ariaLabel?: string
}

export const RaceIcon = React.memo(({ race, className, ariaLabel }: RaceIconProps) => {
  const icon = ICONS[race]
  return <StyledIcon className={className} as={icon} $race={race} aria-label={ariaLabel} />
})
