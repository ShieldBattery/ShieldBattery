import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import LoadingIndicator from '../progress/dots'

const Container = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;

  -webkit-app-region: drag;
`

@connect(state => ({ loading: state.loading }))
export default class LoadingFilter extends React.Component {
  render() {
    // TODO(tec27): make a really awesome loading screen
    if (this.props.loading.toSeq().some(v => v)) {
      return (
        <Container>
          <LoadingIndicator />
        </Container>
      )
    } else {
      return React.Children.only(this.props.children)
    }
  }
}
