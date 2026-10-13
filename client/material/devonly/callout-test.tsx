import styled from 'styled-components'
import { FilledButton, TextButton } from '../button'
import { Callout } from '../callout'

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px !important;
  padding-top: 64px !important;
`

const Content = styled.div`
  max-width: 760px;
  margin: 0px auto;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

export function CalloutTest() {
  return (
    <Container>
      <Content>
        <Callout
          icon='bolt'
          title='Try the new matchmaking preferences'
          actions={
            <>
              <TextButton label='Not now' />
              <FilledButton label='Open' />
            </>
          }>
          Veto maps and pick your race for each matchup before you queue.
        </Callout>
        <Callout icon='bolt' title='No actions'>
          A prominent callout that only informs.
        </Callout>
        <Callout variant='inline' icon='warning' actions={<TextButton label='Fix it' />}>
          This setting has no effect in the current display mode.
        </Callout>
        <Callout variant='inline' icon='info'>
          An inline callout without actions.
        </Callout>
      </Content>
    </Container>
  )
}
