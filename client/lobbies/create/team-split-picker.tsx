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
    const maxTop = Math.floor(slots / 2)
    if (value > maxTop) {
      // A mirrored split (e.g. 6v2 on 8 slots) falls outside the balanced range covered by the
      // chips below, so it needs its own chip to stay representable.
      options.push(value)
    }
    // Most balanced split first, the lopsided ones after
    options.push(...Array.from(range(1, maxTop + 1)).reverse())
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
