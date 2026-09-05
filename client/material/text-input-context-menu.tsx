import * as React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../common/errors'
import { useContextMenu } from '../dom/use-context-menu'
import logger from '../logging/logger'
import { MenuItem } from './menu/item'
import { MenuList } from './menu/menu'
import { Popover } from './popover'

interface TextInputEditMenuState {
  hasSelection: boolean
  readOnly: boolean
  isPassword: boolean
  hasValue: boolean
}

// Chromium throws when reading selection bounds on input types that don't support text selection
// (number, date, color, etc.) instead of returning null, so this must swallow that to stay safe.
function hasTextSelection(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  try {
    return input.selectionStart !== input.selectionEnd
  } catch {
    return false
  }
}

/**
 * Provides the Electron edit menu for an input or textarea, including the input state that was
 * current when the menu opened.
 */
export function useTextInputContextMenu(): {
  onContextMenu: (event: React.MouseEvent, input: HTMLInputElement | HTMLTextAreaElement) => void
  closeContextMenu: () => void
  contextMenu: React.ReactNode
} {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const { onContextMenu: openContextMenu, contextMenuPopoverProps } = useContextMenu()
  const [editMenuState, setEditMenuState] = useState<TextInputEditMenuState>({
    hasSelection: false,
    readOnly: false,
    isPassword: false,
    hasValue: false,
  })

  const onContextMenu = (
    event: React.MouseEvent,
    input: HTMLInputElement | HTMLTextAreaElement,
  ) => {
    // Prevent parent context menus from opening alongside the text input edit menu.
    event.stopPropagation()
    inputRef.current = input
    setEditMenuState({
      hasSelection: hasTextSelection(input),
      readOnly: input.readOnly,
      isPassword: input.type === 'password',
      hasValue: input.value.length > 0,
    })
    openContextMenu(event)
  }

  const closeContextMenu = () => contextMenuPopoverProps.onDismiss()

  return {
    onContextMenu,
    closeContextMenu,
    contextMenu: IS_ELECTRON ? (
      <Popover {...contextMenuPopoverProps}>
        <TextInputContextMenuContents
          editState={editMenuState}
          inputRef={inputRef}
          onDismiss={contextMenuPopoverProps.onDismiss}
        />
      </Popover>
    ) : null,
  }
}

/**
 * The cut/copy/paste/select-all menu for a text input in the Electron app.
 */
function TextInputContextMenuContents({
  editState,
  inputRef,
  onDismiss,
}: {
  editState: TextInputEditMenuState
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { hasSelection, readOnly, isPassword, hasValue } = editState

  const focusInput = () => inputRef.current?.focus()

  return (
    <MenuList dense={true}>
      <MenuItem
        text={t('common.actions.cut', 'Cut')}
        disabled={!hasSelection || readOnly || isPassword}
        onClick={() => {
          focusInput()
          document.execCommand('cut')
          onDismiss()
        }}
      />
      <MenuItem
        text={t('common.actions.copy', 'Copy')}
        disabled={!hasSelection || isPassword}
        onClick={() => {
          focusInput()
          document.execCommand('copy')
          onDismiss()
        }}
      />
      <MenuItem
        text={t('common.actions.paste', 'Paste')}
        disabled={readOnly}
        onClick={() => {
          focusInput()
          // execCommand('insertText') replaces the current selection and dispatches a real input
          // event, allowing React's controlled onChange handler to receive the pasted value.
          navigator.clipboard
            .readText()
            .then(text => {
              if (text) {
                document.execCommand('insertText', false, text)
              }
            })
            .catch(err => logger.error(`Error reading from clipboard: ${getErrorStack(err)}`))
          onDismiss()
        }}
      />
      <MenuItem
        text={t('common.actions.selectAll', 'Select All')}
        disabled={!hasValue}
        onClick={() => {
          focusInput()
          inputRef.current?.select()
          onDismiss()
        }}
      />
    </MenuList>
  )
}
