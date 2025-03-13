import React from 'react'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ElevatedButton, IconButton, TextButton } from '../button'
import { Card } from '../card'
import { FloatingActionButton } from '../floating-action-button'

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

  & > * {
    margin-top: 8px;
  }
`

export default class ButtonsTest extends React.Component {
  render() {
    return (
      <Container>
        <StyledCard>
          <h3>Press some buttons</h3>
          <ElevatedButton label='Raised primary' />
          <ElevatedButton label='Raised primary disabled' disabled={true} />
          <ElevatedButton label='Raised accent' color='accent' />
          <ElevatedButton label='Raised accent disabled' color='accent' disabled={true} />
          <TextButton label='Flat normal' />
          <TextButton label='Flat normal disabled' disabled={true} />
          <TextButton label='Flat primary' color='primary' />
          <TextButton label='Flat primary disabled' color='primary' disabled={true} />
          <TextButton label='Flat accent' color='accent' />
          <TextButton label='Flat accent disabled' color='accent' disabled={true} />
          <IconButton icon={<MaterialIcon icon='magic_button' />} title='Icon button' />
          <IconButton
            icon={<MaterialIcon icon='local_pizza' />}
            title='Icon button disabled'
            disabled={true}
          />
          <FloatingActionButton
            icon={<MaterialIcon icon='elderly' invertColor={true} />}
            title='FAB'
          />
          <FloatingActionButton
            icon={<MaterialIcon icon='skull' invertColor={true} />}
            title='Disabled FAB'
            disabled={true}
          />
        </StyledCard>
      </Container>
    )
  }
}
