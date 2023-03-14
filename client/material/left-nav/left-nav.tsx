import React from 'react'
import styled from 'styled-components'
import { background700 } from '../../styles/colors'

const Header = styled.div``
const Footer = styled.div``

const Container = styled.nav`
  width: 272px;

  display: flex;
  flex-direction: column;
  flex-grow: 0;
  flex-shrink: 0;

  background-color: ${background700};
`

const Sections = styled.div`
  padding: 8px 0 0;
  flex-grow: 1;
  overflow-y: auto;
`

export interface LeftNavProps {
  children?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}

export default function LeftNav(props: LeftNavProps) {
  const header = props.header ? <Header>{props.header}</Header> : undefined
  const footer = props.footer ? <Footer>{props.footer}</Footer> : undefined
  return (
    <Container data-test='left-nav'>
      {header}
      <Sections>{props.children}</Sections>
      {footer}
    </Container>
  )
}
