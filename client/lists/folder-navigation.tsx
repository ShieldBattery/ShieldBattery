import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyMedium, labelLarge, singleLine, titleSmall } from '../styles/typography'

/**
 * Navigation through a read-only mirror of folders on disk: a breadcrumb of the folders down to the
 * current one, and rows for the folders inside it. Folders are `/`-separated paths; the listing
 * built on these decides what each path holds.
 */

/** One step of a breadcrumb: a folder, or (with no `path`) the top level above every folder. */
export interface FolderCrumb {
  path: string | undefined
  label: string
}

const Breadcrumb = styled.nav`
  min-width: 0;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
`

const Separator = styledWithAttrs(MaterialIcon, { icon: 'chevron_right', size: 20 })`
  color: var(--theme-on-surface-variant);
`

const Current = styled.span`
  ${labelLarge};
  ${singleLine};
  padding: 0 12px;
  color: var(--theme-on-surface);
`

/** The folders from the top level down to the current one; the last crumb is the current one. */
export function FolderBreadcrumb({
  crumbs,
  onNavigate,
}: {
  crumbs: ReadonlyArray<FolderCrumb>
  onNavigate: (path: string | undefined) => void
}) {
  const { t } = useTranslation()
  return (
    <Breadcrumb aria-label={t('lists.folders.breadcrumb', 'Folders')}>
      {crumbs.map((crumb, i) => {
        const isCurrent = i === crumbs.length - 1
        return (
          <span key={crumb.path ?? ''} style={{ display: 'contents' }}>
            {i > 0 ? <Separator /> : null}
            {isCurrent ? (
              <Current aria-current='location'>{crumb.label}</Current>
            ) : (
              <TextButton label={crumb.label} onClick={() => onNavigate(crumb.path)} />
            )}
          </span>
        )
      })}
    </Breadcrumb>
  )
}

/** A folder inside the current one. */
export interface FolderRow {
  path: string
  name: string
  /** How many items the folder holds, at any depth. */
  count: number
}

const Rows = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
`

const Row = styled.button`
  min-width: 0;
  padding: 10px 12px;

  display: flex;
  align-items: center;
  gap: 12px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  background: none;
  color: var(--theme-on-surface);
  text-align: start;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: 2px;
  }
`

const RowIcon = styledWithAttrs(MaterialIcon, { icon: 'folder', size: 24 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const RowText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const RowName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const RowCount = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/** The folders inside the current one, each with how many items it holds. */
export function FolderRows({
  folders,
  countLabel,
  onOpen,
}: {
  folders: ReadonlyArray<FolderRow>
  /** How to describe a folder's item count, e.g. "12 maps". */
  countLabel: (count: number) => string
  onOpen: (path: string) => void
}) {
  return (
    <Rows>
      {folders.map(folder => (
        <Row key={folder.path} type='button' onClick={() => onOpen(folder.path)}>
          <RowIcon />
          <RowText>
            <RowName title={folder.name}>{folder.name}</RowName>
            <RowCount>{countLabel(folder.count)}</RowCount>
          </RowText>
        </Row>
      ))}
    </Rows>
  )
}

/**
 * The crumbs from the top level down to `path`. `label` names each folder by its path and own name
 * (so callers can give top-level folders friendlier names).
 */
export function crumbsForPath(
  path: string | undefined,
  topLabel: string,
  label: (path: string, name: string) => string,
): FolderCrumb[] {
  const crumbs: FolderCrumb[] = [{ path: undefined, label: topLabel }]
  if (path === undefined) {
    return crumbs
  }
  const segments = path.split('/')
  segments.forEach((name, i) => {
    const crumbPath = segments.slice(0, i + 1).join('/')
    crumbs.push({ path: crumbPath, label: label(crumbPath, name) })
  })
  return crumbs
}
