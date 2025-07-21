import * as React from 'react'
import { Except, SetRequired, Simplify } from 'type-fest'
import { useMultiplexRef } from '../react/refs'
import { useObservedDimensions } from './dimension-hooks'

type ImgProps = React.JSX.IntrinsicElements['img']

/**
 * Returns an image that will set its `sizes` attribute to its current width automatically for use
 * with `srcSet`.
 */
export function AutoSizeImage(props: Simplify<SetRequired<Except<ImgProps, 'sizes'>, 'srcSet'>>) {
  const { ref, src, srcSet, ...rest } = props
  const [imageRef, imageRect] = useObservedDimensions()

  const multiRef = useMultiplexRef(ref, imageRef)

  // NOTE(tec27): We withold the src/srcSet attributes until we know the dimensions of the image,
  // to avoid the browser immediately loading the full-size image and loading the lower res version
  // right after
  return (
    <img
      {...rest}
      ref={multiRef}
      src={imageRect ? src : undefined}
      srcSet={imageRect ? srcSet : undefined}
      sizes={imageRect ? `${Math.round(imageRect.width)}px` : undefined}
    />
  )
}
