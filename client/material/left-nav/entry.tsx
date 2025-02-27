import React from 'react'
import styled from 'styled-components'
import { Link } from 'wouter'
import { singleLine, titleSmall } from '../../styles/typography'
import AttentionIndicator from './attention-indicator'

const Container = styled.li<{ $isCurrentPath: boolean; $isActive?: boolean }>`
  position: relative;
  height: 36px;
  margin: 0;
  padding: 0;

  display: flex;
  justify-content: space-between;
  align-items: center;

  background-color: ${props =>
    props.$isCurrentPath || props.$isActive ? 'rgba(255, 255, 255, 0.12)' : 'transparent'};
  line-height: 36px;
  color: ${props => (props.$isCurrentPath ? 'var(--color-amber80)' : 'currentColor')};

  &:hover {
    background-color: rgba(255, 255, 255, 0.12);
  }

  a:link,
  a:visited,
  a:hover,
  a:active {
    color: currentColor;
    text-decoration: none;
  }
`

const EntryLink = styled(Link)`
  ${titleSmall};
  ${singleLine};

  height: 100%;
  line-height: 36px;

  flex-grow: 1;
  padding: 0 16px;
`

const EntryButton = styled.div`
  height: 100%;
  opacity: 0;

  ${Container}:hover & {
    opacity: 1;
  }
`

export interface EntryProps {
  link: string
  currentPath: string
  children: React.ReactNode
  title?: string
  button?: React.ReactNode
  needsAttention?: boolean
  isActive?: boolean
  className?: string
  onContextMenu?: (event: React.MouseEvent) => void
}

// TODO(2Pac): Try to rework this component to make it more customizable, so it could be used in all
// nav-entries. Or, remove this component and instead only export smaller components that encompass
// common functionality/design across all the nav-entries, and leave it to specific nav-entries to
// use those smaller components to create a nav-entry to their liking.
export function Entry({
  link,
  currentPath,
  title,
  button,
  needsAttention,
  isActive,
  className,
  children,
  onContextMenu,
}: EntryProps) {
  const isCurrentPath = link.toLowerCase() === currentPath.toLowerCase()

  // TODO(tec27): only add title if the link is actually cut off, or add marquee'ing?
  return (
    <Container
      $isCurrentPath={isCurrentPath}
      $isActive={isActive}
      className={className}
      onContextMenu={onContextMenu}>
      {needsAttention ? <AttentionIndicator /> : null}
      <EntryLink to={link} title={title}>
        {children}
      </EntryLink>
      <EntryButton>{button}</EntryButton>
    </Container>
  )
}
