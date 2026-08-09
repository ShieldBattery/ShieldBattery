import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType } from '../../../common/games/game-type'
import { range } from '../../../common/range'
import { FilterChip } from '../../material/filter-chip'

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

export interface TeamSplitPickerProps {
  gameType: GameType
  slots: number
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

/**
 * A row of chips, each a way to split `slots` seats into teams for `gameType`. For `TopVsBottom`,
 * `value` is the top team's seat count; for the other team types, it's the number of teams.
 */
export function TeamSplitPicker({
  gameType,
  slots,
  value,
  onChange,
  disabled,
}: TeamSplitPickerProps) {
  const { t } = useTranslation()

  const isTopVsBottom = gameType === GameType.TopVsBottom
  const options: number[] = []
  if (isTopVsBottom) {
    // Both orientations of each split are offered (1v3 and 3v1 are distinct — the value is the
    // top team's seat count, so they produce different slot layouts). The most balanced split
    // leads since it's the most common pick; the rest follow ordered by top team size.
    const balanced = Math.floor(slots / 2)
    options.push(balanced, ...Array.from(range(1, slots)).filter(o => o !== balanced))
  } else {
    const maxTeams = Math.min(4, slots)
    options.push(...range(2, maxTeams + 1))
  }

  return (
    <Row>
      {options.map(option => {
        const label = isTopVsBottom
          ? t('lobbies.createLobby.teamSplitOption', {
              defaultValue: '{{top}}v{{bottom}}',
              top: option,
              bottom: slots - option,
            })
          : t('lobbies.createLobby.gameSubTypeOption', {
              defaultValue: '{{numTeams}} teams',
              numTeams: option,
            })

        return (
          <FilterChip
            key={option}
            label={label}
            selected={option === value}
            checkmark={false}
            disabled={disabled}
            onClick={() => onChange(option)}
          />
        )
      })}
    </Row>
  )
}
