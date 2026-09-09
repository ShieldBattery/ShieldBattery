import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, test } from 'vitest'
import { SnackbarController } from './snackbar-controller-registry'
import { DURATION_LONG } from './snackbar-durations'
import { SnackbarOverlay, useSnackbarController } from './snackbar-overlay'

let capturedController: SnackbarController | undefined

function ControllerGrabber() {
  const controller = useSnackbarController()

  useEffect(() => {
    capturedController = controller
  }, [controller])

  return null
}

describe('client/snackbars/snackbar-overlay', () => {
  beforeEach(() => {
    capturedController = undefined
  })

  const doRender = () => {
    render(
      <SnackbarOverlay>
        <ControllerGrabber />
      </SnackbarOverlay>,
    )

    return {
      showSnackbar: (message: string, options?: { dedupe?: boolean }) => {
        act(() => {
          capturedController!.showSnackbar(message, DURATION_LONG, options)
        })
      },
      // The only button on screen is the showing snackbar's close button
      dismiss: () => {
        fireEvent.click(screen.getByRole('button'))
      },
    }
  }

  test('a deduped snackbar is dropped while an identical one is showing or queued', () => {
    const { showSnackbar, dismiss } = doRender()

    showSnackbar('a', { dedupe: true })
    showSnackbar('a', { dedupe: true })
    showSnackbar('b')
    showSnackbar('a', { dedupe: true })

    expect(screen.getByText('a')).toBeDefined()

    dismiss()
    expect(screen.queryByText('a')).toBeNull()
    expect(screen.getByText('b')).toBeDefined()

    dismiss()
    expect(screen.queryByText('a')).toBeNull()
    expect(screen.queryByText('b')).toBeNull()
  })

  test('a snackbar without dedupe is queued even when an identical one is showing', () => {
    const { showSnackbar, dismiss } = doRender()

    showSnackbar('a')
    showSnackbar('a')

    expect(screen.getByText('a')).toBeDefined()

    dismiss()
    expect(screen.getByText('a')).toBeDefined()

    dismiss()
    expect(screen.queryByText('a')).toBeNull()
  })
})
