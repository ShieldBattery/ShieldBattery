import styled from 'styled-components'
import { bodyMedium, bodySmall, labelMedium } from '../../styles/typography'

/** Props for the grid rows below; `$columns` is a `grid-template-columns` value. */
interface TableColumnsProps {
  $columns: string
}

export const TableHeader = styled.div<TableColumnsProps>`
  display: grid;
  grid-template-columns: ${props => props.$columns};
  column-gap: 16px;
  align-items: center;
  padding: 0 12px;
  margin-bottom: 4px;
`

export const TableHeaderCell = styled.div<{ $highlighted?: boolean }>`
  ${labelMedium};

  color: ${props =>
    props.$highlighted ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)'};
  transition: color 150ms linear;
`

export const TableRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

export const TableRow = styled.div<TableColumnsProps>`
  display: grid;
  grid-template-columns: ${props => props.$columns};
  column-gap: 16px;
  align-items: center;
  padding: 8px 12px;

  background-color: var(--theme-container-low);
  border-radius: 4px;
`

export const SettingName = styled.div`
  ${bodyMedium};
`

export const SettingPage = styled.div`
  ${bodySmall};

  color: var(--theme-on-surface-variant);
`
