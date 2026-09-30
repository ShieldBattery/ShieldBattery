import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FilledButtonProps } from '../material/button'
import type { TextFieldProps } from '../material/text-field'
import { AdminUrgentMessage } from './urgent-message'

const { clientQuery, setUrgentMessage, showSnackbar } = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  setUrgentMessage: vi.fn(),
  showSnackbar: vi.fn(),
}))

vi.mock('urql', () => ({
  useClient: () => ({ query: clientQuery }),
  useMutation: () => [{ fetching: false, error: undefined }, setUrgentMessage],
}))

vi.mock('../snackbars/snackbar-overlay', () => ({
  useSnackbarController: () => ({ showSnackbar }),
}))

vi.mock('../material/button', () => ({
  FilledButton: ({ label, type, onClick, disabled }: FilledButtonProps) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
  OutlinedButton: ({ label, onClick, disabled }: FilledButtonProps) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
}))

vi.mock('../material/text-field', () => ({
  TextField: ({ label, name, value, onChange, errorText, disabled }: TextFieldProps) => (
    <label>
      {label}
      <input name={name} value={value} onChange={onChange} disabled={disabled} />
      {errorText ? <span>{errorText}</span> : null}
    </label>
  ),
}))

vi.mock('../markdown/markdown', () => ({ Markdown: () => null }))
vi.mock('../icons/material/material-icon', () => ({ MaterialIcon: () => null }))

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  clientQuery.mockReset()
  setUrgentMessage.mockReset().mockResolvedValue({ data: { newsSetUrgentMessage: true } })
  showSnackbar.mockReset()
})

function field(name: string) {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!
}

function fill(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } })
}

describe('client/admin/urgent-message', () => {
  test('loads the current message with network-only policy and replaces missing translations with empty fields', async () => {
    clientQuery.mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: {
            urgentMessage: {
              title: 'Maintenance',
              message: 'Back soon',
              translations: [
                { language: 'es', title: 'Mantenimiento', message: 'Volvemos pronto' },
              ],
            },
          },
        }),
    })
    render(<AdminUrgentMessage />)
    fill('koTitle', 'A stale draft')

    fireEvent.click(screen.getByRole('button', { name: 'Load current message' }))

    await waitFor(() => expect(field('enTitle').value).toBe('Maintenance'))
    expect(clientQuery).toHaveBeenCalledWith(
      expect.anything(),
      {},
      { requestPolicy: 'network-only' },
    )
    expect(field('enMessage').value).toBe('Back soon')
    expect(field('esTitle').value).toBe('Mantenimiento')
    expect(field('esMessage').value).toBe('Volvemos pronto')
    expect(field('koTitle').value).toBe('')
    expect(field('koMessage').value).toBe('')
    expect(showSnackbar).toHaveBeenCalledWith('Current message loaded into the editor')
  })

  test('submits English and nonblank translations while omitting blank translations', async () => {
    render(<AdminUrgentMessage />)
    fill('enTitle', 'Maintenance')
    fill('enMessage', 'Back soon')
    fill('esTitle', 'Mantenimiento')
    fill('esMessage', 'Volvemos pronto')
    fill('koTitle', '   ')
    fill('koMessage', '   ')

    fireEvent.click(screen.getByRole('button', { name: 'Set Urgent Message' }))

    await waitFor(() => expect(setUrgentMessage).toHaveBeenCalled())
    expect(setUrgentMessage).toHaveBeenCalledWith({
      message: {
        title: 'Maintenance',
        message: 'Back soon',
        translations: [{ language: 'es', title: 'Mantenimiento', message: 'Volvemos pronto' }],
      },
    })
    await waitFor(() => expect(showSnackbar).toHaveBeenCalledWith('Urgent message set'))
  })

  test('blocks submission when English title or message is blank', async () => {
    render(<AdminUrgentMessage />)
    fill('enTitle', '   ')
    fill('enMessage', '   ')

    fireEvent.click(screen.getByRole('button', { name: 'Set Urgent Message' }))

    await waitFor(() => expect(screen.getByText('Enter an English title')).toBeDefined())
    expect(screen.getByText('Enter an English message')).toBeDefined()
    expect(setUrgentMessage).not.toHaveBeenCalled()
  })

  test('does not show success feedback when setting the message fails', async () => {
    setUrgentMessage.mockResolvedValue({ error: new Error('request failed') })
    render(<AdminUrgentMessage />)
    fill('enTitle', 'Maintenance')
    fill('enMessage', 'Back soon')

    fireEvent.click(screen.getByRole('button', { name: 'Set Urgent Message' }))

    await waitFor(() => expect(setUrgentMessage).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('request failed'))
    expect(showSnackbar).not.toHaveBeenCalledWith('Urgent message set')
  })

  test('preserves the draft and reports a failed load', async () => {
    clientQuery.mockReturnValue({
      toPromise: () => Promise.resolve({ error: new Error('load failed') }),
    })
    render(<AdminUrgentMessage />)
    fill('enTitle', 'Unsaved draft')

    fireEvent.click(screen.getByRole('button', { name: 'Load current message' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('load failed'))
    expect(field('enTitle').value).toBe('Unsaved draft')
    expect(showSnackbar).not.toHaveBeenCalled()
  })

  test('preserves the draft when there is no current message', async () => {
    clientQuery.mockReturnValue({
      toPromise: () => Promise.resolve({ data: { urgentMessage: null } }),
    })
    render(<AdminUrgentMessage />)
    fill('enTitle', 'Unsaved draft')

    fireEvent.click(screen.getByRole('button', { name: 'Load current message' }))

    await waitFor(() =>
      expect(showSnackbar).toHaveBeenCalledWith('There is no current urgent message'),
    )
    expect(field('enTitle').value).toBe('Unsaved draft')
  })

  test('clears the current message and reports successful clearing', async () => {
    render(<AdminUrgentMessage />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear Urgent Message' }))

    await waitFor(() => expect(setUrgentMessage).toHaveBeenCalledWith({}))
    await waitFor(() => expect(showSnackbar).toHaveBeenCalledWith('Urgent message cleared'))
  })
})
