import { useStore } from 'jotai'
import { DevTools } from 'jotai-devtools'
import 'jotai-devtools/styles.css'
import keycode from 'keycode'
import { useEffect, useState } from 'react'
import { createGlobalStyle } from 'styled-components'

const I = keycode('i')

const ShowHideStyle = createGlobalStyle`
  #jotai-devtools-root {
    display: var(--jotai-devtools-display, unset) !important;
  }
`

export function JotaiDevTools() {
  const [show, setShow] = useState(false)
  const store = useStore()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.keyCode === I && event.ctrlKey) {
        setShow(s => !s)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--jotai-devtools-display', show ? 'unset' : 'none')
  }, [show])

  return (
    <>
      <ShowHideStyle />
      <DevTools
        store={store}
        nonce={(window as any).SB_CSP_NONCE}
        options={{ snapshotHistoryLimit: 30 }}
        isInitialOpen={true}
      />
    </>
  )
}
