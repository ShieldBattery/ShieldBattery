import { useState } from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { CenteredContentContainer } from '../../styles/centered-container'
import { TitleLarge, TitleMedium } from '../../styles/typography'
import { Card } from '../card'
import { FilterChip } from '../filter-chip'
import { SelectableMenuItem } from '../menu/selectable-item'

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
  margin-inline: auto;
  margin-top: 24px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

type SortOption = 'latest' | 'oldest' | 'shortest' | 'longest'
type DurationOption = 'all' | 'under10' | '10to20' | '20to30' | 'over30'

const SORT_OPTIONS: SortOption[] = ['latest', 'oldest', 'shortest', 'longest']
const DURATION_OPTIONS: DurationOption[] = ['all', 'under10', '10to20', '20to30', 'over30']

const SORT_LABELS: Record<SortOption, string> = {
  latest: 'Latest first',
  oldest: 'Oldest first',
  shortest: 'Shortest first',
  longest: 'Longest first',
}

const DURATION_LABELS: Record<DurationOption, string> = {
  all: 'All durations',
  under10: 'Under 10min',
  '10to20': '10-20min',
  '20to30': '20-30min',
  over30: 'Over 30min',
}

export function ChipTest() {
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set(['ranked']))
  const [sortOption, setSortOption] = useState<SortOption>('latest')
  const [durationOption, setDurationOption] = useState<DurationOption>('all')

  const toggleChip = (id: string) => {
    setSelectedChips(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <CenteredContentContainer>
      <StyledCard>
        <TitleLarge>Filter Chips</TitleLarge>

        <TitleMedium>Interactive Example</TitleMedium>
        <Row>
          <FilterChip
            label='Ranked'
            selected={selectedChips.has('ranked')}
            onClick={() => toggleChip('ranked')}
          />
          <FilterChip
            label='Custom'
            selected={selectedChips.has('custom')}
            onClick={() => toggleChip('custom')}
          />
          <FilterChip
            label='Unranked'
            selected={selectedChips.has('unranked')}
            onClick={() => toggleChip('unranked')}
          />
        </Row>

        <TitleMedium>States</TitleMedium>
        <Row>
          <FilterChip label='Unselected' />
          <FilterChip label='Selected' selected={true} />
          <FilterChip label='Disabled' disabled={true} />
          <FilterChip label='Selected Disabled' selected={true} disabled={true} />
        </Row>

        <TitleMedium>With Icons</TitleMedium>
        <Row>
          <FilterChip
            label='With Icon'
            icon={<MaterialIcon icon='star' size={18} />}
            selected={false}
          />
          <FilterChip
            label='Selected with Icon'
            icon={<MaterialIcon icon='star' size={18} />}
            selected={true}
          />
          <FilterChip label='Selected (auto checkmark)' selected={true} />
        </Row>

        <TitleMedium>Game Source Filter Example</TitleMedium>
        <Row>
          <FilterChip
            label='Ranked'
            icon={<MaterialIcon icon='trophy' size={18} />}
            selected={selectedChips.has('ranked-example')}
            onClick={() => toggleChip('ranked-example')}
          />
          <FilterChip
            label='Custom'
            icon={<MaterialIcon icon='groups' size={18} />}
            selected={selectedChips.has('custom-example')}
            onClick={() => toggleChip('custom-example')}
          />
        </Row>

        <TitleMedium>Filter Chips with Menu</TitleMedium>
        <Row>
          <FilterChip label={SORT_LABELS[sortOption]} icon={<MaterialIcon icon='sort' size={18} />}>
            {SORT_OPTIONS.map(option => (
              <SelectableMenuItem
                key={option}
                text={SORT_LABELS[option]}
                selected={sortOption === option}
                onClick={() => setSortOption(option)}
              />
            ))}
          </FilterChip>

          <FilterChip
            label={DURATION_LABELS[durationOption]}
            icon={<MaterialIcon icon='schedule' size={18} />}>
            {DURATION_OPTIONS.map(option => (
              <SelectableMenuItem
                key={option}
                text={DURATION_LABELS[option]}
                selected={durationOption === option}
                onClick={() => setDurationOption(option)}
              />
            ))}
          </FilterChip>
        </Row>

        <TitleMedium>Filter Chip with Menu (disabled)</TitleMedium>
        <Row>
          <FilterChip label='Disabled chip' disabled={true}>
            <SelectableMenuItem text='Option 1' selected={true} onClick={() => {}} />
            <SelectableMenuItem text='Option 2' selected={false} onClick={() => {}} />
          </FilterChip>
        </Row>
      </StyledCard>
    </CenteredContentContainer>
  )
}
