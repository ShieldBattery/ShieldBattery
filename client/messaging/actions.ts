import React from 'react'

export type MessagingActions = MaybeOpenExternalLinkDialog

export interface MaybeOpenExternalLinkDialog {
  type: '@messaging/maybeOpenExternalLinkDialog'
  payload: React.MouseEvent<HTMLAnchorElement>
}
