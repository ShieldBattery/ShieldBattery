import React from 'react'
import { maybeOpenExternalLinkDialog } from '../messaging/action-creators'
import { useAppDispatch } from '../redux-hooks'

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
