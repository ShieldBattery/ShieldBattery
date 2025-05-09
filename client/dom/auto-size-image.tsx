import React from 'react'
import { Except, SetRequired, Simplify } from 'type-fest'
import { useMultiplexRef } from '../react/refs'
import { useObservedDimensions } from './dimension-hooks'

type ImgProps = React.JSX.IntrinsicElements['img']

/**
 * Returns an image that will set its `sizes` attribute to its current width automatically for use
 * with `srcSet`.
 */
export function AutoSizeImage(props: Simplify<SetRequired<Except<ImgProps, 'sizes'>, 'srcSet'>>) {
  const { ref, ...rest } = props
  const [imageRef, imageRect] = useObservedDimensions()

  const multiRef = useMultiplexRef(ref, imageRef)

  return (
    <img {...rest} ref={multiRef} sizes={imageRect ? `${Math.round(imageRect.width)}px` : 'auto'} />
  )
}
