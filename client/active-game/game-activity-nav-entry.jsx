import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { colorTextSecondary } from '../styles/colors.js'
import { Body2, Title, robotoCondensed, singleLine } from '../styles/typography.js'

const Container = styled.li`
  height: 72px;
  margin: 0;
  padding: 0 16px;

  &:hover {
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

const StyledTitle = styled(Title)`
  ${robotoCondensed};
  ${singleLine};
  margin: 0;
  font-weight: 700;
`

const Subtitle = styled(Body2)`
  ${singleLine};
  color: ${colorTextSecondary};
  margin-top: 8px;
  font-size: 16px;
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
