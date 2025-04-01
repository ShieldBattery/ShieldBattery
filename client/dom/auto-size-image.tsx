import React from 'react'
import { Except, SetRequired, Simplify } from 'type-fest'
import { assignRef } from '../react/refs'
import { useObservedDimensions } from './dimension-hooks'

type ImgProps = React.JSX.IntrinsicElements['img']

/**
 * Returns an image that will set its `sizes` attribute to its current width automatically for use
 * with `srcSet`.
 */
export function AutoSizeImage(props: Simplify<SetRequired<Except<ImgProps, 'sizes'>, 'srcSet'>>) {
  const { ref, ...rest } = props
  const [imageRef, imageRect] = useObservedDimensions()

  return (
    <img
      {...rest}
      ref={node => {
        const cb = assignRef(ref, node)
        const cb2 = assignRef(imageRef, node)

        return () => {
          if (!cb) {
            assignRef(ref, null)
          } else {
            cb()
          }
          if (!cb2) {
            assignRef(imageRef, null)
          } else {
            cb2()
          }
        }
      }}
      sizes={imageRect ? `${Math.round(imageRect.width)}px` : 'auto'}
    />
  )
}
