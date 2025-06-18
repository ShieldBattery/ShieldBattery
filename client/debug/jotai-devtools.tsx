import { useStore } from 'jotai'
import { DevTools } from 'jotai-devtools'
import 'jotai-devtools/styles.css'
import keycode from 'keycode'
import { useEffect, useState } from 'react'

const I = keycode('i')

export function JotaiDevTools() {
  const [show, setShow] = useState(false)
  const store = useStore()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.keyCode === I && event.ctrlKey && !event.shiftKey) {
        setShow(s => !s)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return show ? (
    <DevTools
      store={store}
      nonce={(window as any).SB_CSP_NONCE}
      options={{ snapshotHistoryLimit: 30 }}
      isInitialOpen={true}
    />
  ) : null
}
