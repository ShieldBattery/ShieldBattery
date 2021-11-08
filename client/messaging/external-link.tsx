import React from 'react'
import { useAppDispatch } from '../redux-hooks'
import { maybeOpenExternalLinkDialog } from './action-creators'

interface ExternalLinkProps {
  href: string
  innerText: string
}

export default function ExternalLink({ href, innerText }: ExternalLinkProps) {
  const dispatch = useAppDispatch()

  return (
    <a
      href={href}
      target='_blank'
      rel='noopener nofollow'
      onClick={e => dispatch(maybeOpenExternalLinkDialog(e))}>
      {innerText}
    </a>
  )
}
