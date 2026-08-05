import styled from 'styled-components'
import { labelSmall } from '../../styles/typography'

const ControlsLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 16px 16px 8px;
`

const ScenarioButtons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 16px;
`

const ScenarioBtn = styled.button<{ $active: boolean }>`
  ${labelSmall};
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  background: ${props =>
    props.$active ? 'color-mix(in srgb, var(--theme-primary) 15%, transparent)' : 'transparent'};
  color: ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-on-surface-variant)')};
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
    border-color: var(--theme-primary);
    color: var(--theme-primary);
  }
`

/**
 * The shared scenario switcher for the lobby devonly test pages.
 */
export function ScenarioPicker<T extends string>({
  scenarios,
  active,
  onChange,
  label = 'Scenario',
}: {
  scenarios: ReadonlyArray<{ id: T; label: string }>
  active: T
  onChange: (scenario: T) => void
  /** What this row of choices is picking between. */
  label?: string
}) {
  return (
    <>
      <ControlsLabel>{label}</ControlsLabel>
      <ScenarioButtons>
        {scenarios.map(s => (
          <ScenarioBtn key={s.id} $active={active === s.id} onClick={() => onChange(s.id)}>
            {s.label}
          </ScenarioBtn>
        ))}
      </ScenarioButtons>
    </>
  )
}
