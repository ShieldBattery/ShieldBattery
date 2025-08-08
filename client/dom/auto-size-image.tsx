import * as React from 'react'
import styled from 'styled-components'
import { Except, SetRequired, Simplify } from 'type-fest'
import { useMultiplexRef } from '../react/refs'
import { useObservedDimensions } from './dimension-hooks'

const StyledImage = styled.img`
  &:not([src]):not([srcSet]) {
    /** Avoid flash of broken image before it's sized */
    visibility: hidden;
  }
`

type ImgProps = React.JSX.IntrinsicElements['img']

/**
 * Returns an image that will set its `sizes` attribute to its current width automatically for use
 * with `srcSet`, optionally scaled by the value of the `scale` prop.
 */
export function AutoSizeImage(
  props: Simplify<SetRequired<Except<ImgProps, 'sizes'>, 'srcSet'> & { scale?: number }>,
) {
  const { ref, src, srcSet, scale, ...rest } = props
  const [imageRef, imageRect] = useObservedDimensions()

  const multiRef = useMultiplexRef<HTMLImageElement>(ref, imageRef)
  // NOTE(tec27): We withold the src/srcSet attributes until we know the dimensions of the image,
  // to avoid the browser immediately loading the full-size image and loading the lower res version
  // right after
  return (
    <StyledImage
      {...rest}
      ref={multiRef}
      src={imageRect ? src : undefined}
      srcSet={imageRect ? srcSet : undefined}
      sizes={imageRect ? `${Math.round(imageRect.width * (scale ?? 1))}px` : undefined}
    />
  )
}
