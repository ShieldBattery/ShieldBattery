import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { Link } from 'wouter'
import { colorTextSecondary } from '../styles/colors'
import { headline6, singleLine, subtitle1 } from '../styles/typography'

const Container = styled.li`
  height: 72px;
  margin: 0 8px;
  padding: 8px;

  background-color: ${props => (props.isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent')};
  border-radius: 2px;

  &:hover {
    background-color: ${props =>
      props.isActive ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)'};
    cursor: pointer;
  }
`

const StyledLink = styled(Link)`
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;

  &:link,
  &:visited,
  &:hover,
  &:active {
    color: currentColor;
    text-decoration: none;
  }
`

const StyledTitle = styled.div`
  ${headline6};
  ${singleLine};
`

const Subtitle = styled.div`
  ${subtitle1};
  ${singleLine};
  color: ${colorTextSecondary};
`

const GameActivityNavEntry = ({ link, currentPath, title, subtitle }) => {
  const isActive = link.toLowerCase() === currentPath.toLowerCase()

  return (
    <Container isActive={isActive}>
      <StyledLink to={link}>
        <StyledTitle>{title}</StyledTitle>
        <Subtitle>{subtitle}</Subtitle>
      </StyledLink>
    </Container>
  )
}

GameActivityNavEntry.propTypes = {
  link: PropTypes.string.isRequired,
  currentPath: PropTypes.string.isRequired,
  title: PropTypes.string,
  subtitle: PropTypes.string,
}

export default GameActivityNavEntry
