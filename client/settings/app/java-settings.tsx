import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { JavaRuntimeInfo } from '../../../common/bots/bot-library'
import { MaterialIcon } from '../../icons/material/material-icon'
import { IconButton, OutlinedButton, TextButton } from '../../material/button'
import { Tooltip } from '../../material/tooltip'
import {
  addJavaInstall,
  clearJavaOverride,
  detectJava,
  removeJavaInstall,
  runAsyncAction,
} from '../../practice/bot-actions'
import { javaRuntimeLabelWithArchitecture } from '../../practice/bot-badges'
import { botLibraryAtom, botViewsAtom } from '../../practice/practice-atoms'
import { bodyMedium, bodySmall, labelLarge } from '../../styles/typography'
import {
  SectionContainer,
  SettingsSectionDescription,
  SettingsSectionHeader,
} from '../settings-content'
import { PathDetail, PathIconTile, PathList, PathName, PathRow, PathText } from './path-list'

const Actions = styled.div`
  margin-top: 12px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const SubsectionTitle = styled.div`
  ${labelLarge};
  margin: 24px 0 4px;
`

const SubsectionDescription = styled.div`
  ${bodyMedium};
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
`

const EmptyText = styled.div`
  ${bodyMedium};
  padding: 8px 12px;
  color: var(--theme-on-surface-variant);
`

const RowNote = styled.div`
  ${bodySmall};
  flex-shrink: 0;
  padding-right: 8px;
  color: var(--theme-on-surface-variant);
`

const BrokenName = styled(PathName)`
  color: var(--theme-error);
`

function samePath(a: string, b: string): boolean {
  // Windows paths (including Wine's drive mappings) compare case-insensitively.
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * The Java installs Java bots run with: the ones the user added, which are tried first, the ones
 * found automatically, and any bot pinned to a specific `java.exe`.
 */
export function JavaSettings() {
  const { t } = useTranslation()
  const library = useAtomValue(botLibraryAtom)
  const bots = useAtomValue(botViewsAtom)
  const [checking, setChecking] = useState(false)

  if (!library) {
    return null
  }

  const { detected, added, overrides } = library.java
  const found = detected.filter(java => !added.some(a => samePath(a.path, java.path)))
  const pinned = Object.entries(overrides)

  const runtimeLabel = (java: JavaRuntimeInfo) =>
    javaRuntimeLabelWithArchitecture(
      { kind: 'java', major: java.major, architecture: java.architecture },
      t,
    )
  const removeLabel = t('settings.app.system.java.remove', 'Remove')

  return (
    <SectionContainer>
      <SettingsSectionHeader>
        {t('settings.app.system.java.title', 'Java for bots')}
      </SettingsSectionHeader>
      <SettingsSectionDescription>
        {t(
          'settings.app.system.java.description',
          'Java bots run with an install matching the Java version and 32 or 64-bit build they ' +
            'need. Installs you add here are tried before the ones found automatically.',
        )}
      </SettingsSectionDescription>

      <PathList>
        {added.map(({ path: javaPath, status }) => {
          const java = detected.find(d => samePath(d.path, javaPath))
          let name: React.ReactNode
          if (status === 'unusable') {
            name = (
              <BrokenName>
                {t('settings.app.system.java.notRunning', "This Java install didn't run")}
              </BrokenName>
            )
          } else if (status === 'usable' && java) {
            name = <PathName>{runtimeLabel(java)}</PathName>
          } else {
            name = <PathName>{t('settings.app.system.java.checkingOne', 'Checking…')}</PathName>
          }
          return (
            <PathRow key={javaPath}>
              <PathIconTile>
                <MaterialIcon icon={status === 'unusable' ? 'error' : 'coffee'} />
              </PathIconTile>
              <PathText>
                {name}
                <PathDetail title={javaPath}>{javaPath}</PathDetail>
              </PathText>
              <Tooltip text={removeLabel}>
                <IconButton
                  icon={<MaterialIcon icon='delete' />}
                  ariaLabel={removeLabel}
                  onClick={() => {
                    runAsyncAction(removeJavaInstall(javaPath))
                  }}
                />
              </Tooltip>
            </PathRow>
          )
        })}
        {found.map(java => (
          <PathRow key={java.path}>
            <PathIconTile>
              <MaterialIcon icon='coffee' />
            </PathIconTile>
            <PathText>
              <PathName>{runtimeLabel(java)}</PathName>
              <PathDetail title={java.path}>{java.path}</PathDetail>
            </PathText>
            <RowNote>
              {t('settings.app.system.java.foundAutomatically', 'Found automatically')}
            </RowNote>
          </PathRow>
        ))}
        {added.length === 0 && found.length === 0 ? (
          <EmptyText>
            {checking
              ? t('settings.app.system.java.checking', 'Looking for Java installs…')
              : t('settings.app.system.java.noneFound', 'No Java installs were found on this PC.')}
          </EmptyText>
        ) : null}
      </PathList>

      <Actions>
        <OutlinedButton
          label={t('settings.app.system.java.add', 'Add a Java install…')}
          iconStart={<MaterialIcon icon='add' />}
          onClick={() => {
            runAsyncAction(addJavaInstall())
          }}
        />
        <TextButton
          label={t('settings.app.system.java.checkAgain', 'Check again')}
          iconStart={<MaterialIcon icon='refresh' />}
          disabled={checking}
          onClick={() => {
            setChecking(true)
            runAsyncAction(detectJava().finally(() => setChecking(false)))
          }}
        />
      </Actions>

      {pinned.length > 0 ? (
        <>
          <SubsectionTitle>
            {t('settings.app.system.java.pinnedTitle', 'Bots with their own Java install')}
          </SubsectionTitle>
          <SubsectionDescription>
            {t(
              'settings.app.system.java.pinnedDescription',
              'These bots always run with the install chosen for them. Reset one to let it use ' +
                'a matching install from above.',
            )}
          </SubsectionDescription>
          <PathList>
            {pinned.map(([key, javaPath]) => (
              <PathRow key={key}>
                <PathIconTile>
                  <MaterialIcon icon='smart_toy' />
                </PathIconTile>
                <PathText>
                  <PathName>{bots.find(bot => bot.key === key)?.name ?? key}</PathName>
                  <PathDetail title={javaPath}>{javaPath}</PathDetail>
                </PathText>
                <TextButton
                  label={t('settings.app.system.java.reset', 'Reset')}
                  onClick={() => {
                    runAsyncAction(clearJavaOverride(key))
                  }}
                />
              </PathRow>
            ))}
          </PathList>
        </>
      ) : null}
    </SectionContainer>
  )
}
