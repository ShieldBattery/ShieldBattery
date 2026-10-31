import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_BOT_RACE_NAMES,
  BotArchitecture,
  BotRaceName,
  BotRuntime,
} from '../../common/bots/bot-catalog'
import { LocalBuildBot, LocalBuildBotSpec } from '../../common/bots/bot-library'
import { TypedIpcRenderer } from '../../common/ipc'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { NumberTextField } from '../material/number-text-field'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { bodySmall, labelSmall } from '../styles/typography'
import { openPracticeLogs, runAsyncAction } from './bot-actions'
import { botRaceToLabel } from './bot-badges'

const ipcRenderer = new TypedIpcRenderer()

const DEFAULT_JAVA_MAJOR = 17

/**
 * Splits a command line the way a shell would: whitespace separates arguments, and quotes keep
 * whitespace inside one argument. Quote characters themselves are never part of an argument.
 */
export function tokenizeArguments(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: string | undefined

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
    } else {
      current += char
      started = true
    }
  }
  if (started) {
    tokens.push(current)
  }

  return tokens
}

/** Renders arguments back into an editable command line, re-quoting the ones that need it. */
export function joinArguments(args: ReadonlyArray<string>): string {
  return args.map(arg => (/\s|"|'/.test(arg) ? `"${arg}"` : arg)).join(' ')
}

function parentDirectory(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  return index > 0 ? filePath.slice(0, index) : filePath
}

const StyledDialog = styled(Dialog)`
  max-width: 640px;
`

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`

/**
 * Centered on the field's input box rather than on the whole field, which also reserves a line
 * below the box for an error message.
 */
const RowButton = styled(OutlinedButton)`
  margin-top: 8px;
`

const GrowingField = styled(TextField)`
  flex-grow: 1;
  min-width: 0;
`

const GrowingNumberField = styled(NumberTextField)`
  flex-grow: 1;
  min-width: 0;
`

const SectionLabel = styled.div`
  ${labelSmall};

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
`

const RaceRow = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
`

const ErrorText = styled.div`
  ${bodySmall};
  color: var(--theme-error);
`

const FootNote = styled.div`
  ${bodySmall};

  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

export interface LocalBuildDialogProps extends CommonDialogProps {
  /** The build being refreshed, or undefined when adding a new one. */
  existing?: LocalBuildBot
  onSaved?: (bot: LocalBuildBot) => void
}

export function LocalBuildDialog({ existing, onSaved, onCancel, close }: LocalBuildDialogProps) {
  const { t } = useTranslation()

  const [executable, setExecutable] = useState(existing?.executable ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [version, setVersion] = useState(existing?.version ?? 'dev')
  const [workingDirectory, setWorkingDirectory] = useState(existing?.workingDirectory ?? '')
  const [args, setArgs] = useState(joinArguments(existing?.args ?? []))
  const [runtimeKind, setRuntimeKind] = useState<BotRuntime['kind']>(
    existing?.runtime.kind ?? 'native',
  )
  const [javaMajor, setJavaMajor] = useState(
    existing?.runtime.kind === 'java' ? existing.runtime.major : DEFAULT_JAVA_MAJOR,
  )
  const [javaArchitecture, setJavaArchitecture] = useState<BotArchitecture>(
    existing?.runtime.kind === 'java' ? existing.runtime.architecture : 'x86',
  )
  // Not editable here, but kept so that saving a build doesn't drop the JVM options it launches with.
  const [jvmArguments, setJvmArguments] = useState(
    existing?.runtime.kind === 'java' ? existing.runtime.jvmArguments : undefined,
  )
  const [races, setRaces] = useState<BotRaceName[]>(existing?.races ?? [])
  const [showErrors, setShowErrors] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  const executableError = executable
    ? undefined
    : t('practice.localBuild.executableRequired', 'Choose the executable to run')
  const nameError = name.trim()
    ? undefined
    : t('practice.localBuild.nameRequired', 'Enter a name for this build')
  const versionError = version.trim()
    ? undefined
    : t('practice.localBuild.versionRequired', 'Enter a version label')
  const javaMajorError =
    runtimeKind === 'java' && !(javaMajor > 0)
      ? t('practice.localBuild.javaMajorRequired', 'Enter the Java version this build needs')
      : undefined
  const racesError =
    races.length === 0
      ? t('practice.localBuild.racesRequired', 'Pick at least one race this build can play')
      : undefined

  const chooseExecutable = async () => {
    const picked = await ipcRenderer.invoke('botLibraryPickLocalBuild')
    if (!picked) {
      return
    }

    setExecutable(picked.executable)
    const spec = picked.spec
    if (spec.name) {
      setName(spec.name)
    } else if (!name) {
      setName(parentDirectory(picked.executable).split(/[\\/]/).pop() ?? '')
    }
    if (spec.version) {
      setVersion(spec.version)
    }
    if (spec.args) {
      setArgs(joinArguments(spec.args))
    }
    setWorkingDirectory(spec.workingDirectory || parentDirectory(picked.executable))
    if (spec.races?.length) {
      setRaces(spec.races)
    }
    if (spec.runtime) {
      setRuntimeKind(spec.runtime.kind)
      if (spec.runtime.kind === 'java') {
        setJavaMajor(spec.runtime.major)
        setJavaArchitecture(spec.runtime.architecture)
        setJvmArguments(spec.runtime.jvmArguments)
      }
    } else if (picked.executable.toLowerCase().endsWith('.jar')) {
      // A JAR can't be launched on its own, so it always needs a Java runtime.
      setRuntimeKind('java')
    }
  }

  const chooseWorkingDirectory = async () => {
    const picked = await ipcRenderer.invoke(
      'botLibraryPickDirectory',
      t('practice.localBuild.chooseWorkingDirectory', 'Choose the working directory'),
    )
    if (picked) {
      setWorkingDirectory(picked)
    }
  }

  const save = async () => {
    setShowErrors(true)
    if (executableError || nameError || versionError || javaMajorError || racesError) {
      return
    }

    const spec: LocalBuildBotSpec = {
      name: name.trim(),
      version: version.trim(),
      executable,
      args: tokenizeArguments(args),
      workingDirectory: workingDirectory || parentDirectory(executable),
      runtime:
        runtimeKind === 'java'
          ? {
              kind: 'java',
              major: javaMajor,
              architecture: javaArchitecture,
              ...(jvmArguments ? { jvmArguments } : {}),
            }
          : { kind: 'native' },
      races,
    }

    try {
      const saved = existing
        ? await ipcRenderer.invoke('botLibraryUpdateLocalBuild', existing.key, spec)
        : await ipcRenderer.invoke('botLibraryAddLocalBuild', spec)
      if (saved) {
        onSaved?.(saved)
      }
      close()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
    <FilledButton
      key='save'
      label={t('common.actions.save', 'Save')}
      onClick={() => {
        runAsyncAction(save())
      }}
    />,
  ]

  return (
    <StyledDialog
      showCloseButton={true}
      onCancel={onCancel}
      buttons={buttons}
      title={
        existing
          ? t('practice.localBuild.editTitle', 'Edit local build')
          : t('practice.localBuild.title', 'Use a local build')
      }>
      <Form>
        <Row>
          <GrowingField
            label={t('practice.localBuild.executable', 'Executable')}
            value={executable}
            floatingLabel={true}
            allowErrors={true}
            errorText={showErrors ? executableError : undefined}
            inputProps={{ readOnly: true }}
            onChange={() => {}}
          />
          <RowButton
            label={t('practice.localBuild.chooseExecutable', 'Choose executable…')}
            onClick={() => {
              runAsyncAction(chooseExecutable())
            }}
          />
        </Row>

        <TextField
          label={t('practice.localBuild.name', 'Name')}
          value={name}
          floatingLabel={true}
          allowErrors={true}
          errorText={showErrors ? nameError : undefined}
          onChange={event => setName(event.target.value)}
        />

        <TextField
          label={t('practice.localBuild.version', 'Version label')}
          value={version}
          floatingLabel={true}
          allowErrors={true}
          errorText={showErrors ? versionError : undefined}
          onChange={event => setVersion(event.target.value)}
        />

        <Row>
          <GrowingField
            label={t('practice.localBuild.workingDirectory', 'Working directory')}
            value={workingDirectory}
            floatingLabel={true}
            allowErrors={false}
            onChange={event => setWorkingDirectory(event.target.value)}
          />
          <RowButton
            label={t('practice.localBuild.chooseDirectory', 'Choose…')}
            onClick={() => {
              runAsyncAction(chooseWorkingDirectory())
            }}
          />
        </Row>

        <TextField
          label={t('practice.localBuild.arguments', 'Arguments')}
          value={args}
          floatingLabel={true}
          allowErrors={false}
          onChange={event => setArgs(event.target.value)}
        />

        <Select
          label={t('practice.localBuild.runtime', 'Runtime')}
          value={runtimeKind}
          allowErrors={false}
          onChange={(value: BotRuntime['kind']) => setRuntimeKind(value)}>
          <SelectOption
            value='native'
            text={t('practice.localBuild.runtimeNative', 'Native (no runtime needed)')}
          />
          <SelectOption value='java' text={t('practice.localBuild.runtimeJava', 'Java')} />
        </Select>

        {runtimeKind === 'java' ? (
          <Row>
            <GrowingNumberField
              label={t('practice.localBuild.javaMajor', 'Java version')}
              value={javaMajor}
              floatingLabel={true}
              allowErrors={true}
              errorText={showErrors ? javaMajorError : undefined}
              onChange={(value: number) => setJavaMajor(value)}
            />
            <Select
              label={t('practice.localBuild.javaArchitecture', 'Java architecture')}
              value={javaArchitecture}
              allowErrors={false}
              onChange={(value: BotArchitecture) => setJavaArchitecture(value)}>
              <SelectOption value='x86' text={t('practice.localBuild.architecture32', '32-bit')} />
              <SelectOption
                value='x86_64'
                text={t('practice.localBuild.architecture64', '64-bit')}
              />
            </Select>
          </Row>
        ) : null}

        <div>
          <SectionLabel>{t('practice.localBuild.races', 'Races it can play')}</SectionLabel>
          <RaceRow>
            {ALL_BOT_RACE_NAMES.map(race => (
              <CheckBox
                key={race}
                checked={races.includes(race)}
                label={botRaceToLabel(race, t)}
                onChange={event =>
                  setRaces(
                    event.target.checked
                      ? [...races, race]
                      : races.filter(existingRace => existingRace !== race),
                  )
                }
              />
            ))}
          </RaceRow>
          {showErrors && racesError ? <ErrorText>{racesError}</ErrorText> : null}
        </div>

        {saveError ? <ErrorText>{saveError}</ErrorText> : null}

        <FootNote>
          <OutlinedButton
            label={t('practice.localBuild.viewLogs', 'View logs')}
            iconStart={<MaterialIcon icon='description' size={18} />}
            onClick={() => {
              runAsyncAction(openPracticeLogs())
            }}
          />
        </FootNote>
      </Form>
    </StyledDialog>
  )
}
