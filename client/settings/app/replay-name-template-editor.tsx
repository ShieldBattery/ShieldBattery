import { TFunction } from 'i18next'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import {
  ALL_REPLAY_NAME_TOKENS,
  DEFAULT_REPLAY_NAME_TEMPLATE,
  MAX_REPLAY_NAME_TEMPLATE_LENGTH,
  parseReplayNameTemplate,
  renderReplayNameTemplate,
  ReplayNamePart,
  ReplayNameToken,
  sanitizeReplayNameText,
  serializeReplayNameTemplate,
} from '../../../common/replay-name-template'
import { useSelfUser } from '../../auth/auth-utils'
import { MaterialIcon } from '../../icons/material/material-icon'
import { TextButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyMedium, bodySmall, labelLarge, labelMedium, singleLine } from '../../styles/typography'
import { mergeAccountSettings } from '../action-creators'
import { SettingsSectionDescription, SettingsSectionHeader } from '../settings-content'

/** A template part with an identity that survives reordering, for React keys. */
interface EditorPart {
  id: number
  part: ReplayNamePart
}

let lastPartId = 0

function toEditorParts(template: string): EditorPart[] {
  return parseReplayNameTemplate(template).map(part => ({ id: ++lastPartId, part }))
}

function serializeEditorParts(parts: ReadonlyArray<EditorPart>): string {
  return serializeReplayNameTemplate(parts.map(p => p.part))
}

function getTokenLabel(token: ReplayNameToken, t: TFunction): string {
  switch (token) {
    case 'date':
      return t('settings.app.system.replayName.token.date', 'Date')
    case 'time':
      return t('settings.app.system.replayName.token.time', 'Time')
    case 'map':
      return t('settings.app.system.replayName.token.map', 'Map')
    case 'name':
      return t('settings.app.system.replayName.token.name', 'Your name')
    case 'opponents':
      return t('settings.app.system.replayName.token.opponents', 'Opponents')
    case 'race':
      return t('settings.app.system.replayName.token.race', 'Your race')
    case 'opponentRaces':
      return t('settings.app.system.replayName.token.opponentRaces', 'Opponent races')
    case 'format':
      return t('settings.app.system.replayName.token.format', 'Format')
    case 'matchup':
      return t('settings.app.system.replayName.token.matchup', 'Matchup')
    default:
      return token satisfies never
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

function makePreviewValues(now: Date, selfName: string) {
  const common = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    map: 'Fighting Spirit',
    name: selfName,
    race: 'Z',
  }
  return {
    oneVOne: {
      ...common,
      opponents: 'Opponent',
      opponentRaces: 'T',
      format: '1v1',
      matchup: 'ZvT',
    },
    twoVTwo: {
      ...common,
      opponents: 'Opponent1+Opponent2',
      opponentRaces: 'PT',
      format: '2v2',
      matchup: 'PZvPT',
    },
  } satisfies Record<string, Record<ReplayNameToken, string>>
}

const Sequence = styled.div`
  min-height: 56px;
  padding: 11px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const EmptySequence = styled.div`
  ${bodyMedium};
  padding: 0 4px;
  color: var(--theme-on-surface-variant);
`

const chipBase = css<{ $dropBefore: boolean; $dropAfter: boolean; $dragging: boolean }>`
  position: relative;
  height: 32px;

  display: inline-flex;
  align-items: center;

  border-radius: 8px;
  cursor: grab;
  opacity: ${props => (props.$dragging ? 0.4 : 1)};

  &::before,
  &::after {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;

    content: '';
    display: none;
    border-radius: 1px;
    background-color: var(--theme-primary);
  }

  &::before {
    left: -5px;
    display: ${props => (props.$dropBefore ? 'block' : 'none')};
  }

  &::after {
    right: -5px;
    display: ${props => (props.$dropAfter ? 'block' : 'none')};
  }
`

const TokenChip = styled.div<{ $dropBefore: boolean; $dropAfter: boolean; $dragging: boolean }>`
  ${chipBase};
  ${labelLarge};
  padding: 0 4px 0 12px;
  gap: 4px;

  background-color: var(--theme-container-high);
  color: var(--theme-on-surface);
`

const TextChip = styled.div<{ $dropBefore: boolean; $dropAfter: boolean; $dragging: boolean }>`
  ${chipBase};
  padding: 0 4px 0 2px;

  border: 1px dashed var(--theme-outline);
`

const DragHandle = styled(MaterialIcon).attrs({ icon: 'drag_indicator', size: 18 })`
  color: var(--theme-on-surface-variant);
`

const TextInput = styled.input`
  ${bodyMedium};
  field-sizing: content;
  min-width: 2ch;
  max-width: 320px;
  padding: 0 2px;

  border: none;
  outline: none;
  background: transparent;
  color: var(--theme-on-surface);
  cursor: text;
`

const RemoveButton = styled.button`
  ${buttonReset};
  width: 24px;
  height: 24px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  color: var(--theme-on-surface-variant);
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
  }
`

const PaletteLabel = styled.div`
  ${labelMedium};
  margin: 16px 0 8px;
  color: var(--theme-on-surface-variant);
`

const Palette = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const PaletteChip = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  padding: 0 12px 0 8px;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  border: 1px solid var(--theme-outline);
  border-radius: 8px;
  color: var(--theme-on-surface);
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
  }

  &:disabled {
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
    border-color: rgb(from var(--theme-on-surface) r g b / 0.12);
    cursor: default;
  }
`

const Preview = styled.div`
  margin-top: 16px;
  padding: 12px 16px;

  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 16px;
  row-gap: 4px;

  border-radius: 8px;
  background-color: var(--theme-container-lowest);
`

const PreviewLabel = styled.div`
  ${bodySmall};
  line-height: 20px;
  color: var(--theme-on-surface-variant);
`

const PreviewName = styled.div`
  ${bodyMedium};
  ${singleLine};
`

const ResetButton = styled(TextButton)`
  align-self: flex-start;
  margin-top: 8px;
`

/**
 * Edits the account's auto-saved replay name template as a row of draggable chips: one per token,
 * plus editable text pieces between them.
 */
export function ReplayNameTemplateEditor() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const template = useAppSelector(s => s.settings.account.replayNameTemplate)

  const [parts, setParts] = useState(() => toEditorParts(template))
  // Another session (or a rejected save) can change the template while this is open. Re-parse only
  // when the value differs from what's being edited, so chips keep their identity (and a text
  // piece keeps focus) across this editor's own saves.
  const [syncedTemplate, setSyncedTemplate] = useState(template)
  if (template !== syncedTemplate) {
    setSyncedTemplate(template)
    if (template !== serializeEditorParts(parts)) {
      setParts(toEditorParts(template))
    }
  }

  const [dragIndex, setDragIndex] = useState<number>()
  const [dropIndex, setDropIndex] = useState<number>()
  const [focusPartId, setFocusPartId] = useState<number>()
  const [previewTime] = useState(() => new Date())
  const pointerOnInputRef = useRef(false)

  const save = (next: ReadonlyArray<EditorPart>) => {
    const value = serializeEditorParts(next)
    if (value !== template) {
      dispatch(
        mergeAccountSettings(
          { replayNameTemplate: value },
          { onSuccess: () => {}, onError: () => {} },
        ),
      )
    }
  }

  const change = (next: EditorPart[], { saveNow = true } = {}) => {
    if (serializeEditorParts(next).length > MAX_REPLAY_NAME_TEMPLATE_LENGTH) {
      return
    }
    setParts(next)
    if (saveNow) {
      save(next)
    }
  }

  const addPart = (part: ReplayNamePart) => {
    const id = ++lastPartId
    // A new text piece is left unsaved until it has text, and focused so it can be typed into.
    change([...parts, { id, part }], { saveNow: part.kind === 'token' })
    if (part.kind === 'text') {
      setFocusPartId(id)
    }
  }

  const removePart = (id: number) => {
    change(parts.filter(p => p.id !== id))
  }

  const onTextChange = (id: number, text: string) => {
    change(
      parts.map(p =>
        p.id === id ? { id, part: { kind: 'text', text: sanitizeReplayNameText(text) } } : p,
      ),
      { saveNow: false },
    )
  }

  const onTextBlur = () => {
    const next = parts.filter(p => p.part.kind !== 'text' || p.part.text !== '')
    change(next)
  }

  const onDragOverChip = (event: React.DragEvent<HTMLElement>, index: number) => {
    if (dragIndex === undefined) {
      return
    }
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setDropIndex(event.clientX < rect.left + rect.width / 2 ? index : index + 1)
  }

  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    if (dragIndex === undefined || dropIndex === undefined) {
      return
    }
    event.preventDefault()
    const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex
    if (to !== dragIndex) {
      const next = [...parts]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(to, 0, moved)
      change(next)
    }
  }

  const onDragEnd = () => {
    setDragIndex(undefined)
    setDropIndex(undefined)
  }

  const dragProps = (index: number) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      // Selecting text in a text piece mustn't pick up the whole chip.
      if (pointerOnInputRef.current) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', '')
      setDragIndex(index)
    },
    onDragOver: (event: React.DragEvent<HTMLElement>) => onDragOverChip(event, index),
    onDragEnd,
    $dragging: dragIndex === index,
    $dropBefore: dragIndex !== undefined && dropIndex === index,
    $dropAfter: dragIndex !== undefined && index === parts.length - 1 && dropIndex === parts.length,
  })

  const templateLength = serializeEditorParts(parts).length
  const canAdd = (part: ReplayNamePart) =>
    templateLength + serializeReplayNameTemplate([part]).length <= MAX_REPLAY_NAME_TEMPLATE_LENGTH

  const previewValues = makePreviewValues(previewTime, selfUser?.name ?? 'Player')
  const removeLabel = t('settings.app.system.replayName.remove', 'Remove')

  return (
    <>
      <SettingsSectionHeader>
        {t('settings.app.system.replayName.title', 'Replay names')}
      </SettingsSectionHeader>
      <SettingsSectionDescription>
        {t(
          'settings.app.system.replayName.description',
          'How replays are named when they are saved automatically after each game. Drag the ' +
            'pieces to reorder them. Saved to your account.',
        )}
      </SettingsSectionDescription>

      <Sequence
        onDragOver={e => {
          if (dragIndex !== undefined) {
            e.preventDefault()
          }
        }}
        onDrop={onDrop}>
        {parts.length === 0 ? (
          <EmptySequence>
            {t(
              'settings.app.system.replayName.empty',
              'Add pieces below. An empty name uses the default.',
            )}
          </EmptySequence>
        ) : null}
        {parts.map(({ id, part }, index) =>
          part.kind === 'token' ? (
            <TokenChip key={id} {...dragProps(index)}>
              {getTokenLabel(part.token, t)}
              <RemoveButton
                type='button'
                title={removeLabel}
                aria-label={removeLabel}
                onClick={() => removePart(id)}>
                <MaterialIcon icon='close' size={18} />
              </RemoveButton>
            </TokenChip>
          ) : (
            <TextChip key={id} {...dragProps(index)}>
              <DragHandle />
              <TextInput
                value={part.text}
                autoFocus={id === focusPartId}
                aria-label={t('settings.app.system.replayName.textLabel', 'Text')}
                placeholder={t('settings.app.system.replayName.textPlaceholder', 'Text')}
                onPointerDown={() => {
                  pointerOnInputRef.current = true
                }}
                onPointerUp={() => {
                  pointerOnInputRef.current = false
                }}
                onPointerLeave={() => {
                  pointerOnInputRef.current = false
                }}
                onChange={e => onTextChange(id, e.target.value)}
                onBlur={onTextBlur}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    // The settings page is a form; Enter finishes the edit rather than submitting.
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                }}
              />
              <RemoveButton
                type='button'
                title={removeLabel}
                aria-label={removeLabel}
                onMouseDown={e => e.preventDefault()}
                onClick={() => removePart(id)}>
                <MaterialIcon icon='close' size={18} />
              </RemoveButton>
            </TextChip>
          ),
        )}
      </Sequence>

      <PaletteLabel>{t('settings.app.system.replayName.add', 'Add a piece')}</PaletteLabel>
      <Palette>
        {ALL_REPLAY_NAME_TOKENS.map(token => (
          <PaletteChip
            key={token}
            type='button'
            disabled={!canAdd({ kind: 'token', token })}
            onClick={() => addPart({ kind: 'token', token })}>
            <MaterialIcon icon='add' size={18} />
            {getTokenLabel(token, t)}
          </PaletteChip>
        ))}
        <PaletteChip
          type='button'
          disabled={!canAdd({ kind: 'text', text: '' })}
          onClick={() => addPart({ kind: 'text', text: '' })}>
          <MaterialIcon icon='add' size={18} />
          {t('settings.app.system.replayName.token.text', 'Text')}
        </PaletteChip>
      </Palette>

      <Preview>
        <PreviewLabel>{t('settings.app.system.replayName.preview1v1', '1v1')}</PreviewLabel>
        <PreviewName>
          {renderReplayNameTemplate(serializeEditorParts(parts), previewValues.oneVOne)}.rep
        </PreviewName>
        <PreviewLabel>{t('settings.app.system.replayName.preview2v2', '2v2')}</PreviewLabel>
        <PreviewName>
          {renderReplayNameTemplate(serializeEditorParts(parts), previewValues.twoVTwo)}.rep
        </PreviewName>
      </Preview>

      <ResetButton
        label={t('settings.app.system.replayName.reset', 'Reset to default')}
        disabled={template === DEFAULT_REPLAY_NAME_TEMPLATE}
        onClick={() => {
          const next = toEditorParts(DEFAULT_REPLAY_NAME_TEMPLATE)
          setParts(next)
          save(next)
        }}
      />
    </>
  )
}
