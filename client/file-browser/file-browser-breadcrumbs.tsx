import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { titleLarge } from '../styles/typography'

const BreadcrumbPiece = styled.span<{ $active: boolean }>`
  ${titleLarge};
  padding: 8px;
  flex-grow: 0;
  flex-shrink: 0;

  color: ${props =>
    props.$active ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
  cursor: ${props => (props.$active ? 'auto' : 'pointer')};
`

const BreadcrumbSeparator = styledWithAttrs(MaterialIcon, { icon: 'chevron_right' })`
  display: inline-block;
  flex-grow: 0;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

interface PathBreadcrumbsProps {
  className?: string
  path: string
  onNavigate: (navPath: string) => void
}

export const PathBreadcrumbs = React.memo<PathBreadcrumbsProps>(
  ({ className, onNavigate, path }) => {
    const pieces = path.split(/[\\/]/g)
    if (pieces[pieces.length - 1] === '') {
      // Remove the last entry if it's empty (due to a trailing slash)
      pieces.pop()
    }
    const { elems } = pieces.reduce<{ elems: React.ReactNode[]; curPath: string }>(
      (r, piece, i) => {
        if (piece.length === 0) {
          return r
        }
        const isLast = i === pieces.length - 1
        r.curPath += (i === 0 ? '' : '\\') + piece
        // Save the value at the current time so the function doesn't always use the last value
        const navPath = r.curPath
        r.elems.push(
          <BreadcrumbPiece
            key={i}
            $active={isLast}
            onClick={isLast ? undefined : () => onNavigate(navPath)}>
            {piece}
          </BreadcrumbPiece>,
        )
        r.elems.push(<BreadcrumbSeparator key={i + '|'} />)

        return r
      },
      { elems: [], curPath: '' },
    )

    return <div className={className}>{elems}</div>
  },
  (prevProps, nextProps) => prevProps.path === nextProps.path,
)
