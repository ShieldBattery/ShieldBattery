import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { Body2, singleLine } from '../../styles/typography'
import { colorTextSecondary } from '../../styles/colors.ts'

const Container = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const Title = styled(Body2)`
  ${singleLine};

  height: 36px;
  margin: 0 16px;
  line-height: 36px;
  color: ${colorTextSecondary};
`

export default class Subheader extends React.Component {
  static propTypes = {
    button: PropTypes.element,
  }

  render() {
    const { button, children } = this.props

    return (
      <Container>
        <Title>{children}</Title>
        {button}
      </Container>
    )
  }
}
