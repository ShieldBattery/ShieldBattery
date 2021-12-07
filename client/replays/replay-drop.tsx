import { useCallback, useEffect } from 'react'
import { useAppDispatch } from '../redux-hooks'
import { openReplay } from './action-creators'

export default function ReplayDrop() {
  const dispatch = useAppDispatch()

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const [file] = e.dataTransfer?.files || []
      if (file?.path.slice(-4) === '.rep') {
        dispatch(openReplay(file.path))
      }
    },
    [dispatch],
  )

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // NOTE: it is not possible to access files during `dragover` now,
    // see this electron issue:
    // https://github.com/electron/electron/issues/9840
    // Thus, just allow any files here and deal with the garbage
    // in `drop` handler
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'
  }, [])

  useEffect(() => {
    document.addEventListener('drop', onDrop)
    document.addEventListener('dragover', onDragOver)

    return () => {
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('dragover', onDragOver)
    }
  }, [onDrop, onDragOver])

  return null
}
