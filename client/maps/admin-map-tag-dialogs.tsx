import { useState } from 'react'
import styled from 'styled-components'
import { useMutation } from 'urql'
import { assertUnreachable } from '../../common/assert-unreachable'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../common/i18n'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MapTagDeleteDialogData, MapTagEditDialogData } from '../dialogs/dialog-type'
import { graphql } from '../gql'
import { MapKind, MapTagAutoRule } from '../gql/graphql'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { bodyLarge, bodyMedium, bodySmall } from '../styles/typography'
import { errorCode } from './map-owner-actions'
import { tagIdForName } from './map-tags'

// Only staff manage the list of map tags, so these dialogs aren't translated.

/** The most characters a tag's name has in any language, as the server counts them. */
const MAX_TAG_NAME_CHARS = 24

const MapTagCreateMutation = graphql(/* GraphQL */ `
  mutation AdminMapTagCreate(
    $name: String!
    $kind: MapKind!
    $names: [MapTagNameInput!]
    $autoRule: MapTagAutoRule
  ) {
    mapTagCreate(name: $name, kind: $kind, names: $names, autoRule: $autoRule) {
      id
      kind
      name
      names {
        locale
        name
      }
      autoRule
      usageCount
    }
  }
`)

const MapTagUpdateMutation = graphql(/* GraphQL */ `
  mutation AdminMapTagUpdate(
    $id: String!
    $name: String
    $names: [MapTagNameInput!]
    $autoRule: MapTagAutoRule
  ) {
    mapTagUpdate(id: $id, name: $name, names: $names, autoRule: $autoRule) {
      id
      kind
      name
      names {
        locale
        name
      }
      autoRule
      usageCount
    }
  }
`)

/** The languages a tag can be given names in besides English, in locale code order. */
const OTHER_LANGUAGES = ALL_TRANSLATION_LANGUAGES.filter(
  language => language !== TranslationLanguage.English,
).sort((a, b) => a.localeCompare(b))

/** The name staff know `language` by. */
function languageName(language: TranslationLanguage): string {
  switch (language) {
    case TranslationLanguage.ChineseSimplified:
      return 'Chinese (Simplified)'
    case TranslationLanguage.English:
      return 'English'
    case TranslationLanguage.Korean:
      return 'Korean'
    case TranslationLanguage.Russian:
      return 'Russian'
    case TranslationLanguage.Spanish:
      return 'Spanish'
    default:
      return assertUnreachable(language)
  }
}

/**
 * What's wrong with `value` as a tag name, by the server's rules (trimmed, at most
 * {@link MAX_TAG_NAME_CHARS} characters, no control characters), or undefined if nothing is. With
 * `needsId`, the name also has to have a character the server can make the tag's id of.
 */
function nameProblem(value: string, needsId: boolean): string | undefined {
  const trimmed = value.trim()
  if (Array.from(trimmed).length > MAX_TAG_NAME_CHARS) {
    return `At most ${MAX_TAG_NAME_CHARS} characters.`
  } else if (/\p{Cc}/u.test(trimmed)) {
    return "This name can't be used."
  } else if (needsId && trimmed && !tagIdForName(trimmed)) {
    return 'The name needs a letter from A to Z or a digit, for the tag’s ID.'
  }
  return undefined
}

/** The rules a melee tag can be given by, in the order they're offered. */
const AUTO_RULES: ReadonlyArray<MapTagAutoRule> = [MapTagAutoRule.RichMinerals]

/** The name of the maps `rule` gives a tag to. */
function autoRuleLabel(rule: MapTagAutoRule): string {
  switch (rule) {
    case MapTagAutoRule.RichMinerals:
      return 'Maps with rich minerals'
    default:
      return assertUnreachable(rule)
  }
}

/** What a failed save of a tag tells staff, given the error code the server sent. */
function saveErrorText(code: unknown): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This tag was deleted.'
    case 'FORBIDDEN':
      return "You don't have permission to manage map tags."
    default:
      return "Couldn't save the tag. Please try again later."
  }
}

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  margin-bottom: 8px;
  color: var(--theme-error);
`

const IdText = styled.div`
  ${bodyMedium};
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
`

const HelperText = styled.div`
  ${bodySmall};
  padding-inline: 12px;
  color: var(--theme-on-surface-variant);
`

const RuleSelect = styled(Select)`
  margin-top: 16px;
`

const BodyText = styled.div`
  ${bodyLarge};
`

/**
 * Adds a tag of `kind` at the end of that kind's tags, or changes `tag`: its English name, its names
 * in the other languages the app is translated into and, for a melee tag, the rule by which the
 * server gives it to maps.
 */
export function MapTagEditDialog({
  kind,
  tag,
  takenRules,
  onCancel,
  close,
}: MapTagEditDialogData & CommonDialogProps) {
  const [{ fetching: creating }, createTag] = useMutation(MapTagCreateMutation)
  const [{ fetching: updating }, updateTag] = useMutation(MapTagUpdateMutation)
  const saving = creating || updating
  const [name, setName] = useState(tag?.name ?? '')
  const [names, setNames] = useState<ReadonlyMap<string, string>>(
    () => new Map(tag?.names.map(n => [n.locale, n.name])),
  )
  const [autoRule, setAutoRule] = useState<MapTagAutoRule | null>(tag?.autoRule ?? null)
  /** Why the server refused the English name, until it's changed. */
  const [nameRefusal, setNameRefusal] = useState<string>()
  /** Why the server refused the rule, until it's changed. */
  const [ruleRefusal, setRuleRefusal] = useState<string>()
  const [errorMessage, setErrorMessage] = useState<string>()

  const nameError = nameRefusal ?? nameProblem(name, !tag)
  const languageErrors = new Map(
    OTHER_LANGUAGES.map(language => [language, nameProblem(names.get(language) ?? '', false)]),
  )
  const invalid =
    !name.trim() ||
    !!nameError ||
    !!ruleRefusal ||
    Array.from(languageErrors.values()).some(error => !!error)
  // Every name it had is sent back, including ones in languages without a field here, since the
  // names sent replace all of them
  const namesToSend = Array.from(names, ([locale, value]) => ({
    locale,
    name: value.trim(),
  })).filter(n => n.name)
  const unchanged =
    !!tag &&
    name.trim() === tag.name &&
    autoRule === tag.autoRule &&
    namesToSend.length === tag.names.length &&
    namesToSend.every(n => tag.names.some(t => t.locale === n.locale && t.name === n.name))

  const onSave = () => {
    if (saving || invalid || unchanged) {
      return
    }
    setErrorMessage(undefined)
    // The rule is always sent: on an update, leaving it out would remove it as well
    const request = tag
      ? updateTag({ id: tag.id, name: name.trim(), names: namesToSend, autoRule })
      : createTag({ name: name.trim(), kind, names: namesToSend, autoRule })
    request
      .then(result => {
        if (!result.error) {
          close()
          return
        }
        const code = errorCode(result.error)
        if (code === 'NAME_TAKEN') {
          setNameRefusal('Another tag already has this name.')
        } else if (code === 'RULE_TAKEN') {
          setRuleRefusal('Another tag already has this rule.')
        } else if (code === 'BAD_REQUEST') {
          setNameRefusal("This name can't be used.")
        } else {
          setErrorMessage(saveErrorText(code))
        }
      })
      .catch(swallowNonBuiltins)
  }

  let title = 'Edit tag'
  if (!tag) {
    title = kind === MapKind.Melee ? 'Add melee tag' : 'Add UMS tag'
  }
  const buttons = [
    <TextButton key='cancel' label='Cancel' onClick={onCancel} />,
    <TextButton
      key='save'
      label='Save'
      disabled={saving || invalid || unchanged}
      onClick={onSave}
    />,
  ]

  return (
    <StyledDialog title={title} buttons={buttons} onCancel={onCancel} showCloseButton={true}>
      <Layout>
        {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
        {tag ? <IdText>ID: {tag.id}</IdText> : null}
        <TextField
          label='Name'
          floatingLabel={true}
          value={name}
          maxLength={MAX_TAG_NAME_CHARS}
          errorText={nameError}
          disabled={saving}
          onChange={event => {
            setName(event.target.value)
            setNameRefusal(undefined)
          }}
          onEnterKeyDown={onSave}
        />
        {OTHER_LANGUAGES.map(language => (
          <TextField
            key={language}
            label={languageName(language)}
            floatingLabel={true}
            value={names.get(language) ?? ''}
            maxLength={MAX_TAG_NAME_CHARS}
            // The room for an error only shows with one, which keeps the fields close together
            allowErrors={!!languageErrors.get(language)}
            errorText={languageErrors.get(language)}
            disabled={saving}
            onChange={event => {
              const value = event.target.value
              setNames(prev => new Map(prev).set(language, value))
            }}
            onEnterKeyDown={onSave}
          />
        ))}
        <HelperText>Left empty, a language shows the English name.</HelperText>
        {kind === MapKind.Melee ? (
          <>
            <RuleSelect
              label='Assign automatically'
              value={autoRule}
              errorText={ruleRefusal}
              disabled={saving}
              onChange={(value: MapTagAutoRule | null) => {
                setAutoRule(value)
                setRuleRefusal(undefined)
              }}>
              <SelectOption value={null} text='Never' />
              {AUTO_RULES.map(rule => {
                const takenBy = takenRules[rule]
                return (
                  <SelectOption
                    key={rule}
                    value={rule}
                    text={
                      takenBy ? `${autoRuleLabel(rule)} (${takenBy} has this)` : autoRuleLabel(rule)
                    }
                    disabled={!!takenBy}
                  />
                )
              })}
            </RuleSelect>
            <HelperText>
              Applies to maps whose tags nobody has edited. Rich minerals means over 5,000 per
              field.
            </HelperText>
          </>
        ) : null}
      </Layout>
    </StyledDialog>
  )
}

/** Confirms deleting a tag that maps have, which takes it off all of them. */
export function MapTagDeleteDialog({
  name,
  usageCount,
  onConfirm,
  onCancel,
  close,
}: MapTagDeleteDialogData & CommonDialogProps) {
  const buttons = [
    <TextButton key='cancel' label='Cancel' onClick={onCancel} />,
    <TextButton
      key='delete'
      label='Delete'
      onClick={() => {
        close()
        onConfirm()
      }}
    />,
  ]

  return (
    <StyledDialog title='Delete tag' buttons={buttons} onCancel={onCancel}>
      <BodyText>
        {`Delete ${name}? It will be removed from ${usageCount} ${usageCount === 1 ? 'map' : 'maps'}.`}
      </BodyText>
    </StyledDialog>
  )
}
