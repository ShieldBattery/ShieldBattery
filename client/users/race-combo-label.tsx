import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { AssignedRaceChar, raceCharToLabel } from '../../common/races'
import { RaceIcon } from '../lobbies/race-icon'

const Combo = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
`

/**
 * 20px keeps a team composition's icons inside a header cell that also has to fit the widest
 * matrix a mode can produce; `RaceIcon` colours itself per race, which is what the axes read by.
 */
const ComboIcon = styled(RaceIcon)`
  width: 20px;
  height: 20px;
`

/** A side of a matchup drawn as its race icons, e.g. the `tp` of a 2v2 matrix's axis. */
export function ComboLabel({ parts }: { parts: AssignedRaceChar[] }) {
  const { t } = useTranslation()
  return (
    <Combo>
      {parts.map((race, i) => (
        // The icons carry no text, so this label is the whole of what a screen reader gets for
        // an axis -- hence the race's full name rather than anything abbreviated.
        <ComboIcon key={i} race={race} ariaLabel={raceCharToLabel(race, t)} />
      ))}
    </Combo>
  )
}
