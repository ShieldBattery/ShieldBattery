import styled from 'styled-components'
import { DURATION_LONG } from '../../snackbars/snackbar-durations'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../../styles/centered-container'
import { FilledButton } from '../button'
import { Snackbar } from '../snackbar'

const Root = styled.div`
  height: calc(100% - 24px);
  margin-top: 24px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`

const StaticSnackbars = styled.div`
  flex-grow: 1;

  display: flex;
  flex-direction: column;

  align-items: center;
  justify-content: center;
  gap: 16px;
`

const Buttons = styled.div`
  padding-block: 24px;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`

export function SnackbarTest() {
  const snackbarController = useSnackbarController()

  return (
    <CenteredContentContainer>
      <Root>
        <StaticSnackbars>
          <Snackbar message='You have just seen a cool test snackbar.' onDismiss={() => {}} />
          <Snackbar message='This one has an action.' actionLabel='Confirm' onDismiss={() => {}} />
          <Snackbar
            message={
              'This snackbar has a really, super, crazy long message that should wrap and ' +
              'not look completely terrible hopefully.'
            }
            onDismiss={() => {}}
          />
          <Snackbar
            message={
              'This snackbar has a really, super, crazy long message that should wrap and ' +
              'not look completely terrible hopefully. It also has an action.'
            }
            actionLabel='Acknowledge'
            onDismiss={() => {}}
          />
        </StaticSnackbars>
        <Buttons>
          <FilledButton
            onClick={() => snackbarController.showSnackbar('This is a short duration snackbar.')}
            label='Short duration'
          />
          <FilledButton
            onClick={() =>
              snackbarController.showSnackbar('This is a long duration snackbar.', DURATION_LONG)
            }
            label='Long duration'
          />
          <FilledButton
            onClick={() =>
              snackbarController.showSnackbar('This is a snackbar with an action.', DURATION_LONG, {
                action: {
                  label: 'Action',
                  onClick: () => {},
                },
              })
            }
            label='With action'
          />
          <FilledButton
            onClick={() =>
              snackbarController.showSnackbar(
                'This is a snackbar with a really, super, incredibly long message that will ' +
                  'probably wrap and stuff.',
              )
            }
            label='Long message'
          />
        </Buttons>
      </Root>
    </CenteredContentContainer>
  )
}
