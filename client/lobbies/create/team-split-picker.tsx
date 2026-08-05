import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType } from '../../../common/games/game-type'
import { range } from '../../../common/range'
import { buttonReset } from '../../material/button-reset'
import { labelLarge } from '../../styles/typography'

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const Card = styled.button<{ $selected: boolean }>`
  ${buttonReset};

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 72px;
  padding: 10px 14px;

  border: 1px solid
    ${props => (props.$selected ? 'var(--theme-amber)' : 'var(--theme-outline-variant)')};
  border-radius: 8px;
  background-color: ${props =>
    props.$selected ? 'rgb(from var(--theme-amber) r g b / 0.12)' : 'transparent'};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'rgb(from var(--theme-amber) r g b / 0.18)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.08)'};
  }

  &:disabled {
    cursor: default;
    opacity: var(--theme-disabled-opacity);
    pointer-events: none;
  }
`

const Diagram = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
`

const DotRow = styled.div`
  display: flex;
  gap: 2px;
`

const Dot = styled.div<{ $amber: boolean }>`
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background-color: ${props =>
    props.$amber ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)'};
`

const CardLabel = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
`

/** Splits `slots` as evenly as possible across `teamCount` teams, front-loading the remainder. */
function evenTeamSizes(slots: number, teamCount: number): number[] {
  return Array.from(
    range(0, teamCount),
    i => Math.floor(slots / teamCount) + (i < slots % teamCount ? 1 : 0),
  )
}

function SplitDiagram({ teamSizes }: { teamSizes: ReadonlyArray<number> }) {
  return (
    <Diagram>
      {teamSizes.map((size, teamIndex) => (
        <DotRow key={teamIndex}>
          {Array.from(range(0, size), dotIndex => (
            <Dot key={dotIndex} $amber={teamIndex === 0} />
          ))}
        </DotRow>
      ))}
    </Diagram>
  )
}

export interface TeamSplitPickerProps {
  gameType: GameType
  slots: number
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

/**
 * A row of selectable cards, each showing a dot-diagram of a way to split `slots` seats into teams
 * for `gameType`, plus a label. For `TopVsBottom`, `value` is the top team's seat count; for the
 * other team types, it's the number of teams.
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
      // cards below, so it needs its own card to stay representable.
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
        const teamSizes = isTopVsBottom ? [option, slots - option] : evenTeamSizes(slots, option)
        const label = isTopVsBottom
          ? `${option} v ${slots - option}`
          : t('lobbies.createLobby.gameSubTypeOption', {
              defaultValue: '{{numTeams}} teams',
              numTeams: option,
            })

        return (
          <Card
            key={option}
            type='button'
            disabled={disabled}
            aria-pressed={option === value}
            $selected={option === value}
            onClick={() => onChange(option)}>
            <SplitDiagram teamSizes={teamSizes} />
            <CardLabel>{label}</CardLabel>
          </Card>
        )
      })}
    </Row>
  )
}
