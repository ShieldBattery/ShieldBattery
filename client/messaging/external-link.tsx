import React from 'react'
import { useAppDispatch } from '../redux-hooks'
import { maybeOpenExternalLinkDialog } from './action-creators'

export interface ExternalLinkProps {
  href: string
  children: React.ReactNode
  className?: string
}

export function ExternalLink({ href, children, className }: ExternalLinkProps) {
  const dispatch = useAppDispatch()

  return (
    <a
      className={className}
      href={href}
      target='_blank'
      rel='nofollow noreferrer noopener'
      onClick={e => dispatch(maybeOpenExternalLinkDialog(e))}>
      {children}
    </a>
  )
}
