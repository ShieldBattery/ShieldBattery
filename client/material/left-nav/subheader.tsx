import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { colorTextSecondary } from '../../styles/colors'
import { labelMedium, singleLine } from '../../styles/typography'

const Container = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const Title = styled.div`
  ${labelMedium};
  ${singleLine};

  height: 36px;
  margin: 0 16px;
  line-height: 36px;
  color: ${colorTextSecondary};
`

interface SubheaderProps {
  button?: React.ReactNode
  children: React.ReactNode
  className?: string
}

function Subheader({ button, children, className }: SubheaderProps) {
  return (
    <Container className={className}>
      <Title>{children}</Title>
      {button}
    </Container>
  )
}

Subheader.propTypes = {
  button: PropTypes.element,
}

export default Subheader
