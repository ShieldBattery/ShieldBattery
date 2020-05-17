import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { colorBackground } from '../../styles/colors'

const Footer = styled.div`
  padding: 0 12px;

  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
`

const Container = styled.nav`
  width: 240px;

  display: flex;
  flex-direction: column;
  flex-grow: 0;
  flex-shrink: 0;

  background-color: ${colorBackground};
`

const Sections = styled.div`
  padding: 8px 0 0;
  flex-grow: 1;
`

function LeftNav(props) {
  const footer = props.footer ? <Footer>{props.footer}</Footer> : undefined
  return (
    <Container>
      <Sections>{props.children}</Sections>
      {footer}
    </Container>
  )
}

LeftNav.propTypes = {
  footer: PropTypes.node,
}

export default LeftNav
