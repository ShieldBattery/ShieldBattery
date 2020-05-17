import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import AttentionIndicator from './attention-indicator.jsx'
import { amberA200 } from '../../styles/colors.js'
import { singleLine } from '../../styles/typography.js'

const Container = styled.li`
  position: relative;
  height: 36px;
  margin: 0;
  padding: 0;

  display: flex;
  justify-content: space-between;
  align-items: center;

  background-color: ${props => (props.isActive ? 'rgba(255, 255, 255, 0.12)' : 'transparent')};
  line-height: 36px;
  color: ${props => (props.isActive ? amberA200 : 'currentColor')};

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
  height: 100%;
  padding: 0 16px;
  flex-grow: 1;
  ${singleLine};
`

const EntryButton = styled.div`
  opacity: 0;
  transition: opacity 100ms linear;

  ${Container}:hover & {
    opacity: 1;
  }
`

export default class Entry extends React.Component {
  static propTypes = {
    link: PropTypes.string.isRequired,
    currentPath: PropTypes.string.isRequired,
    title: PropTypes.string,
    button: PropTypes.element,
    needsAttention: PropTypes.bool,
  }

  render() {
    const { link, currentPath, title, button, needsAttention, children } = this.props
    const isActive = link.toLowerCase() === currentPath.toLowerCase()

    // TODO(tec27): only add title if the link is actually cut off, or add marquee'ing?
    return (
      <Container isActive={isActive}>
        {needsAttention ? <AttentionIndicator /> : null}
        <EntryLink to={link} title={title}>
          {children}
        </EntryLink>
        <EntryButton>{button}</EntryButton>
      </Container>
    )
  }
}
