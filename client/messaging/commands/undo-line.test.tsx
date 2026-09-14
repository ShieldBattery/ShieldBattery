import { act, fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThunkAction } from '../../dispatch-registry'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { UndoLine } from './undo-line'

// The line dispatches the reversing request itself, so the hook it reaches for is stood in with a
// plain spy rather than wrapping every render in a real store.
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }))

vi.mock('../../redux-hooks', () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: () => undefined,
}))

// The label comes from a `useTranslation` of its own, which needs an initialized i18next instance.
beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const specs: Array<RequestHandlingSpec<void>> = []
const undo = vi.fn((spec: RequestHandlingSpec<void>): ThunkAction => {
  specs.push(spec)
  return () => {}
})
const onUndoError = vi.fn()

function renderLine() {
  render(
    <UndoLine
      content='Removed tec27 from your friends.'
      undoneContent='Friend request sent to tec27.'
      undo={undo}
      onUndoError={onUndoError}
    />,
  )
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
}

describe('messaging/commands/undo-line', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    specs.length = 0
  })

  test('the line says what happened and offers to undo it', () => {
    renderLine()

    expect(screen.getByText(/Removed tec27 from your friends\./)).toBeDefined()
    expect(undoButton().disabled).toBe(false)
    expect(undo).not.toHaveBeenCalled()
  })

  test('undoing sends the reversing request and waits for it', () => {
    renderLine()
    fireEvent.click(undoButton())

    expect(undo).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(undoButton().disabled).toBe(true)
  })

  test('a successful undo leaves nothing further to undo', () => {
    renderLine()
    fireEvent.click(undoButton())
    act(() => specs[0].onSuccess())

    expect(screen.getByText('Friend request sent to tec27.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('an undo that failed is answered separately and can be tried again', () => {
    renderLine()
    fireEvent.click(undoButton())

    const err = new Error('the server is on fire')
    act(() => specs[0].onError(err))

    expect(onUndoError).toHaveBeenCalledWith(err)
    expect(screen.getByText(/Removed tec27 from your friends\./)).toBeDefined()
    expect(undoButton().disabled).toBe(false)
  })
})
