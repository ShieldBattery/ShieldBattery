import React, { useState } from 'react'
import { useStableCallback } from '../state-hooks'

interface FileDropZoneProps {
  /** File extensions that should be handled by this component. */
  extensions: string[]
  /** Callback that will be called when a file is being dragged over this element. */
  onDrag?: (e: React.DragEvent) => void
  /**
   * Callback that will be called when a file is no longer being dragged over this element (whether
   * or not it was dropped). If a file was dropped, `onFilesDropped` will also be called.
   */
  onDragEnd?: (e: React.DragEvent) => void
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
 * provided to this component will rendered only when files are being dragged over it (but note that
 * filtering for file extension will only occur on drop, due to limitations in the browser API).
 *
 * NOTE: You'll probably want to disable pointer events on the children of this component so they
 * don't interface with the drag events on the parent.
 */
export function FileDropZone(props: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const onDrop = useStableCallback((e: React.DragEvent) => {
    setIsDragging(false)
    props.onDragEnd?.(e)

    const files = Array.from(e.dataTransfer.files).filter(f => {
      const parts = f.name.split('.')
      const extension = parts.length > 1 ? parts[parts.length - 1] : ''
      return props.extensions.includes(extension)
    })

    if (files.length) {
      e.preventDefault()
      e.stopPropagation()
      props.onFilesDropped(files)
    }
  })

  const onDragOver = useStableCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'link'
    setIsDragging(true)
    props.onDrag?.(e)
  })
  const onDragLeave = useStableCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    props.onDragEnd?.(e)
  })

  return (
    <div
      className={props.className}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}>
      {isDragging ? props.children : null}
    </div>
  )
}
