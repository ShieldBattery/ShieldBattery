import React from 'react'
import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import { AutoSizeMaterialIcon } from '../icons/material/material-icon'
import ZergIcon from '../icons/starcraft/hydra_24px.svg'
import TerranIcon from '../icons/starcraft/marine_24px.svg'
import ProtossIcon from '../icons/starcraft/zealot_24px.svg'
import { getRaceColor } from '../styles/colors'

const RandomIcon = styled(AutoSizeMaterialIcon).attrs({ icon: 'casino' })``

const ICONS: Record<RaceChar, React.ComponentType<any>> = {
  r: RandomIcon,
  p: ProtossIcon,
  t: TerranIcon,
  z: ZergIcon,
}

const StyledIcon = styled.svg<{ $race: RaceChar; $applyRaceColor: boolean }>`
  color: ${props => (props.$applyRaceColor ? getRaceColor(props.$race) : 'currentColor')};
`

export interface RaceIconProps {
  race: RaceChar
  className?: string
  ariaLabel?: string
  applyRaceColor?: boolean
}

export const RaceIcon = React.memo(
  ({ race, className, ariaLabel, applyRaceColor = true }: RaceIconProps) => {
    const icon = ICONS[race]
    return (
      <StyledIcon
        className={className}
        as={icon}
        $race={race}
        $applyRaceColor={applyRaceColor}
        aria-label={ariaLabel}
      />
    )
  },
)
