import React from 'react'
import styled from 'styled-components'

import Button from '../button'
import Card from '../card'
import FlatButton from '../flat-button'
import { FloatingActionButton } from '../floating-action-button'
import IconButton from '../icon-button'
import RaisedButton from '../raised-button'

import Icon from '../../icons/material/baseline-check_circle-24px.svg'

const Container = styled.div`
  display: flex;
  justify-content: center;
  height: auto !important;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  max-width: 640px;
  margin-left: 16px;
`

export default class ButtonsTest extends React.Component {
  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Press some buttons</h3>
          <Button label='Default' />
          <Button label='Default disabled' disabled={true} />
          <RaisedButton label='Raised primary' />
          <RaisedButton label='Raised primary disabled' disabled={true} />
          <RaisedButton label='Raised accent' color='accent' />
          <RaisedButton label='Raised accent disabled' color='accent' disabled={true} />
          <FlatButton label='Flat normal' />
          <FlatButton label='Flat normal disabled' disabled={true} />
          <FlatButton label='Flat primary' color='primary' />
          <FlatButton label='Flat primary disabled' color='primary' disabled={true} />
          <FlatButton label='Flat accent' color='accent' />
          <FlatButton label='Flat accent disabled' color='accent' disabled={true} />
          <IconButton icon={<Icon />} title='Icon button' />
          <IconButton icon={<Icon />} title='Icon button disabled' disabled={true} />
          <FloatingActionButton icon={<Icon />} title='Floating action button' />
        </StyledCard>
      </Container>
    )
  }
}
