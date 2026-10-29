import { type ReactNode, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import type { ThirdPartyLicensesFile, ThirdPartyPackage } from '../../common/third-party-licenses'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'
import { PolicyPage } from '../policies/policy-displays'
import { LoadingDotsArea } from '../progress/dots'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  inter,
  labelMedium,
  titleLarge,
} from '../styles/typography'
import { BUNDLED_ASSETS, type BundledAsset } from './bundled-assets'

const ipcRenderer = new TypedIpcRenderer()

/**
 * The license data written by each build whose code is running here (see
 * `build-plugins/third-party-licenses.ts`). The app reads its own copies rather than the server's,
 * since an installed app can be a different version than the website.
 */
const LICENSE_FILE_URLS = IS_ELECTRON
  ? ['app-renderer', 'app-main', 'app-preload'].map(
      build => `shieldbattery://app/dist/third-party-licenses/${build}.json`,
    )
  : ['/third-party-licenses.json']

async function loadPackages(signal: AbortSignal): Promise<ThirdPartyPackage[]> {
  const files = await Promise.all(
    LICENSE_FILE_URLS.map(url =>
      fetchJson<ThirdPartyLicensesFile>(url, { signal, credentials: 'omit' }),
    ),
  )

  const byNameVersion = new Map<string, ThirdPartyPackage>()
  for (const file of files) {
    for (const pkg of file.packages) {
      byNameVersion.set(`${pkg.name}@${pkg.version}`, pkg)
    }
  }
  return Array.from(byNameVersion.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )
}

const Intro = styled.p`
  ${bodyLarge};
  margin: 0 0 24px;
`

const SectionHeader = styled.h3`
  ${titleLarge};
  margin: 32px 0 8px;
`

const SectionDescription = styled.p`
  ${bodyMedium};
  margin: 0 0 16px;
  color: var(--theme-on-surface-variant);
`

const EntryList = styled.div`
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const ExpandIcon = styled(MaterialIcon).attrs({ icon: 'chevron_right', size: 20 })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  transition: transform 150ms ease-out;
`

const Entry = styled.details`
  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }

  &[open] ${ExpandIcon} {
    transform: rotate(90deg);
  }
`

const SummaryRow = styled.summary`
  ${bodyLarge};
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 8px;
  cursor: pointer;
  list-style: none;

  &::-webkit-details-marker {
    display: none;
  }

  &:hover {
    background-color: var(--theme-container-low);
  }
`

function EntrySummary({ children }: { children: ReactNode }) {
  return (
    <SummaryRow>
      <ExpandIcon />
      <span>{children}</span>
    </SummaryRow>
  )
}

const EntryLicense = styled.span`
  ${labelMedium};
  margin-left: 8px;
  color: var(--theme-on-surface-variant);
`

const EntryBody = styled.div`
  ${bodyMedium};
  padding: 0 16px 16px;
  user-select: text;

  & * {
    user-select: text;
  }
`

const EntryDetail = styled.p`
  margin: 0 0 8px;
`

const LicenseFileName = styled.div`
  ${labelMedium};
  margin: 16px 0 4px;
  color: var(--theme-on-surface-variant);
`

const LicenseText = styled.pre`
  ${inter};
  ${bodySmall};
  margin: 0;
  padding: 12px;
  max-height: 320px;
  overflow: auto;

  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: 4px;
  background-color: var(--theme-container-lowest);
`

function ExternalLink({ href }: { href: string }) {
  return (
    <a href={href} target='_blank' rel='noopener noreferrer'>
      {href}
    </a>
  )
}

function AssetEntry({ asset }: { asset: BundledAsset }) {
  const { t } = useTranslation()
  return (
    <Entry>
      <EntrySummary>
        {asset.name}
        <EntryLicense>{asset.license}</EntryLicense>
      </EntrySummary>
      <EntryBody>
        <EntryDetail>
          {t('licenses.assetAuthor', {
            defaultValue: 'By {{author}}',
            author: asset.author,
          })}
        </EntryDetail>
        <EntryDetail>
          <ExternalLink href={asset.source} />
        </EntryDetail>
        {asset.modifications ? (
          <EntryDetail>
            {t('licenses.assetModifications', {
              defaultValue: 'Changes: {{modifications}}',
              modifications: asset.modifications,
            })}
          </EntryDetail>
        ) : null}
        {asset.licenseText ? <LicenseText>{asset.licenseText.trim()}</LicenseText> : null}
      </EntryBody>
    </Entry>
  )
}

function PackageEntry({ pkg }: { pkg: ThirdPartyPackage }) {
  const { t } = useTranslation()
  return (
    <Entry>
      <EntrySummary>
        {pkg.name} {pkg.version}
        <EntryLicense>{pkg.license}</EntryLicense>
      </EntrySummary>
      <EntryBody>
        {pkg.repository ? (
          <EntryDetail>
            <ExternalLink href={pkg.repository} />
          </EntryDetail>
        ) : null}
        {pkg.licenseFiles.length ? (
          pkg.licenseFiles.map(file => (
            <div key={file.fileName}>
              <LicenseFileName>{file.fileName}</LicenseFileName>
              <LicenseText>{file.text.trim()}</LicenseText>
            </div>
          ))
        ) : (
          <EntryDetail>
            {t('licenses.noLicenseFile', {
              defaultValue:
                'This package does not include a license file. It is licensed under {{license}}.',
              license: pkg.license,
            })}
          </EntryDetail>
        )}
      </EntryBody>
    </Entry>
  )
}

function PackagesSection() {
  const { t } = useTranslation()
  const [packages, setPackages] = useState<ThirdPartyPackage[]>()
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    loadPackages(controller.signal).then(setPackages, (err: unknown) => {
      if (controller.signal.aborted) return
      logger.error(`Failed to load third-party licenses: ${getErrorStack(err)}`)
      setLoadFailed(true)
    })
    return () => controller.abort()
  }, [])

  let content
  if (loadFailed) {
    content = (
      <SectionDescription>
        {t(
          'licenses.packagesUnavailable',
          'The list of software packages could not be loaded. It is only generated by release ' +
            'builds.',
        )}
      </SectionDescription>
    )
  } else if (!packages) {
    content = <LoadingDotsArea />
  } else {
    content = (
      <EntryList>
        {packages.map(pkg => (
          <PackageEntry key={`${pkg.name}@${pkg.version}`} pkg={pkg} />
        ))}
      </EntryList>
    )
  }

  return (
    <>
      <SectionHeader>{t('licenses.packagesHeader', 'Software packages')}</SectionHeader>
      <SectionDescription>
        {IS_ELECTRON
          ? t(
              'licenses.packagesDescriptionApp',
              'Open source packages included in this version of the ShieldBattery app.',
            )
          : t(
              'licenses.packagesDescriptionWeb',
              'Open source packages included in this version of the ShieldBattery website.',
            )}
      </SectionDescription>
      {content}
    </>
  )
}

/**
 * A license notices file that ships beside the app, read through the main process, or
 * `unavailableText` if this build doesn't have it.
 */
function ShippedNotices({
  invokeable,
  fileName,
  unavailableText,
}: {
  invokeable: 'licensesGetGameNotices' | 'licensesGetDiscordSdkNotices'
  fileName: string
  unavailableText: string
}) {
  const [notices, setNotices] = useState<string | null>()

  useEffect(() => {
    let canceled = false
    ipcRenderer.invoke(invokeable)?.then(
      result => {
        if (!canceled) setNotices(result ?? null)
      },
      (err: unknown) => {
        logger.error(`Failed to load ${fileName}: ${getErrorStack(err)}`)
        if (!canceled) setNotices(null)
      },
    )
    return () => {
      canceled = true
    }
  }, [invokeable, fileName])

  if (notices === undefined) {
    return <LoadingDotsArea />
  } else if (notices === null) {
    return <SectionDescription>{unavailableText}</SectionDescription>
  } else {
    return (
      <EntryList>
        <Entry>
          <EntrySummary>{fileName}</EntrySummary>
          <EntryBody>
            <LicenseText>{notices}</LicenseText>
          </EntryBody>
        </Entry>
      </EntryList>
    )
  }
}

function GameSection() {
  const { t } = useTranslation()

  return (
    <>
      <SectionHeader>{t('licenses.gameHeader', 'In-game')}</SectionHeader>
      <SectionDescription>
        {t(
          'licenses.gameDescription',
          'Open source software and fonts included in the part of ShieldBattery that runs inside ' +
            'StarCraft.',
        )}
      </SectionDescription>
      <ShippedNotices
        invokeable='licensesGetGameNotices'
        fileName='THIRD_PARTY_NOTICES.txt'
        unavailableText={t(
          'licenses.gameUnavailable',
          'The in-game license notices are missing. They are only generated by release builds.',
        )}
      />
      <SectionHeader>{t('licenses.discordSdkHeader', 'Discord Social SDK')}</SectionHeader>
      <SectionDescription>
        {t(
          'licenses.discordSdkDescription',
          'The app shows your activity on Discord through the Discord Social SDK, which includes ' +
            'other open source software.',
        )}
      </SectionDescription>
      <ShippedNotices
        invokeable='licensesGetDiscordSdkNotices'
        fileName='License-Notices.txt'
        unavailableText={t(
          'licenses.discordSdkUnavailable',
          "This build doesn't include the Discord Social SDK.",
        )}
      />
      <SectionHeader>{t('licenses.electronHeader', 'Electron and Chromium')}</SectionHeader>
      <SectionDescription>
        {t(
          'licenses.electronDescription',
          'The app is built on Electron, which includes Chromium and other open source software. ' +
            'Their licenses are in LICENSE.electron.txt and LICENSES.chromium.html, in the ' +
            'folder ShieldBattery is installed to.',
        )}
      </SectionDescription>
    </>
  )
}

export function LicensesPage() {
  const { t } = useTranslation()

  return (
    <PolicyPage title={t('licenses.title', 'Open source licenses')}>
      <Intro>
        <Trans t={t} i18nKey='licenses.intro'>
          ShieldBattery is open source under the MIT license, and you can find its source code on{' '}
          <a href='https://github.com/ShieldBattery/ShieldBattery' target='_blank' rel='noopener'>
            GitHub
          </a>
          . It is built with the help of many other open source projects, which are listed here
          along with their licenses.
        </Trans>
      </Intro>

      <SectionHeader>{t('licenses.assetsHeader', 'Fonts, sounds, and icons')}</SectionHeader>
      <EntryList>
        {BUNDLED_ASSETS.map(asset => (
          <AssetEntry key={asset.name} asset={asset} />
        ))}
      </EntryList>

      <PackagesSection />
      {IS_ELECTRON ? <GameSection /> : null}
    </PolicyPage>
  )
}
