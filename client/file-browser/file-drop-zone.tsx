import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

interface FileDropZoneState {
  isDocumentDragging: boolean
  onDrop: () => void
}

const FileDropZoneContext = React.createContext<FileDropZoneState>({
  isDocumentDragging: false,
  onDrop: () => {},
})

export interface FileDropZoneProviderProps {
  children: React.ReactNode
}

export function FileDropZoneProvider({ children }: FileDropZoneProviderProps) {
  const [isDocumentDragging, setIsDocumentDragging] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const onDragEnd = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
    setIsDocumentDragging(false)
  }, [])

  useEffect(() => {
    const onDragging = (event?: DragEvent) => {
      // Only consider it dragging if it contains files, so we don't trigger the drag UI for someone
      // dragging a highlighted string around or something
      if (event?.dataTransfer?.types?.includes('Files')) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        setIsDocumentDragging(true)
        timeoutRef.current = setTimeout(onDragEnd, 300)
      }
    }

    document.addEventListener('dragover', onDragging)

    return () => {
      document.removeEventListener('dragover', onDragging)
    }
  }, [onDragEnd])

  return (
    <FileDropZoneContext.Provider
      value={{
        isDocumentDragging,
        onDrop: onDragEnd,
      }}>
      {children}
    </FileDropZoneContext.Provider>
  )
}

const Root = styled.div<{ $isDocumentDragging: boolean }>`
  pointer-events: ${props => (props.$isDocumentDragging ? 'auto' : 'none')};
`

interface FileDropZoneProps {
  /** File extensions that should be handled by this component. */
  extensions: string[]
  /**
   * Callback that will be called when a file (or multiple files) is dropped on this element,
   * provided that any of the dropped files have an extension matching `extensions`.
   */
  onFilesDropped: (files: File[]) => void

  className?: string
  children?: React.ReactNode
}

/**
 * A component that allows for files with particular extensions to be dropped on it. Children
 * provided to this component will rendered only when files are being dragged over the document (but
 * note that filtering for file extension will only occur on drop, due to limitations in the browser
 * API).
 *
 * NOTE: You'll probably want to disable pointer events on the children of this component so they
 * don't interface with the drag events on the parent.
 */
export function FileDropZone({
  extensions,
  onFilesDropped,
  className,
  children,
}: FileDropZoneProps) {
  const { isDocumentDragging, onDrop: onDragEnd } = useContext(FileDropZoneContext)

  return (
    <Root
      $isDocumentDragging={isDocumentDragging}
      className={className}
      onDrop={e => {
        onDragEnd()

        const files = Array.from(e.dataTransfer.files).filter(f => {
          const parts = f.name.toLowerCase().split('.')
          const extension = parts.length > 1 ? parts[parts.length - 1] : ''
          return extensions.includes(extension)
        })

        if (files.length) {
          e.preventDefault()
          e.stopPropagation()
          onFilesDropped(files)
        }
      }}
      onDragOver={e => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'link'
      }}>
      {isDocumentDragging ? children : null}
    </Root>
  )
}
