import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { push } from '../navigation/routing'
import { CenteredContentContainer } from '../styles/centered-container'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  headlineLarge,
  labelSmall,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { navigateToDownload } from './download-navigate'

/*
  Deliberately not a scroll container: this fills whatever scrollable page container the usage
  site provides (`OnlyInAppPage` for standalone routes). That lets the glow extend upward past
  this component and get clipped by the *page's* scroll container instead, so the light reads as
  bleeding out from under the app bar rather than cutting off at this component's top edge.
*/
const Root = styled.div`
  width: 100%;
  min-height: 100%;

  display: flex;
  flex-direction: column;

  /*
    Biases the vertical centering upwards: the optical center of the page sits above the
    mathematical one. Shrinks away (before the content scrolls) when space is tight.
  */
  &::after {
    content: '';
    flex: 0 1 12vh;
  }
`

const Content = styled.div`
  position: relative;

  width: 100%;
  flex-shrink: 0;
  margin-block: auto;
  padding-block: 48px;

  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;

  /*
    A soft glow behind the heading area. Anchored to the content (rather than the page) so it
    stays with the text when the content is vertically centered in a tall viewport. It reaches
    well above the content so the enclosing scroll container clips it at the top of the page,
    under the app bar. The negative z-index (with no isolation on this element) sinks it beneath
    sibling page chrome too (e.g. the play page's tab row) rather than tinting over it.
  */
  &::before {
    content: '';
    position: absolute;
    z-index: -1;
    left: 50%;
    top: -350px;
    transform: translateX(-50%);
    width: 1200px;
    height: 700px;
    background: radial-gradient(closest-side, var(--color-blue20), transparent 80%);
    pointer-events: none;
  }
`

const Title = styled.div`
  ${headlineLarge};
  color: var(--theme-on-surface);

  @media (max-width: 880px) {
    ${titleLarge};
  }
`

const Subtitle = styled.div`
  ${bodyLarge};
  margin-top: 12px;
  max-width: 480px;
  color: var(--theme-on-surface-variant);

  @media (max-width: 880px) {
    ${bodyMedium};
    max-width: 320px;
  }
`

const Features = styled.div`
  width: 100%;
  max-width: 840px;
  margin-top: 40px;

  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;

  @media (max-width: 880px) {
    max-width: 400px;
    margin-top: 32px;
    grid-template-columns: 1fr;
    gap: 12px;
  }
`

const FeatureCard = styled(Card)`
  padding: 24px 20px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  @media (max-width: 880px) {
    padding: 16px;
    flex-direction: row;
    gap: 16px;
    text-align: left;
  }
`

const FeatureIcon = styled(MaterialIcon)`
  color: var(--color-blue80);
  flex-shrink: 0;
`

const FeatureText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FeatureTitle = styled.div`
  ${titleSmall};
  color: var(--theme-on-surface);
`

const FeatureDescription = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Actions = styled.div`
  margin-top: 44px;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;

  @media (max-width: 880px) {
    width: 100%;
    max-width: 400px;
    margin-top: 36px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
`

const InstallerButtonLabel = styled.span`
  ${bodyLarge};
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const WindowsNote = styled.div`
  ${labelSmall};
  display: none;
  margin-top: 4px;
  color: var(--theme-on-surface-variant);

  @media (max-width: 880px) {
    display: block;
  }
`

/** `OnlyInApp` wrapped in its own scrollable page container, for standalone routes. */
export function OnlyInAppPage() {
  return (
    <CenteredContentContainer>
      <OnlyInApp />
    </CenteredContentContainer>
  )
}

export function OnlyInApp() {
  const { t } = useTranslation()

  return (
    <Root>
      <Content>
        <Title>{t('clientDownload.onlyInAppTitle', 'Take it into the app')}</Title>
        <Subtitle>
          {t('clientDownload.onlyInAppBlurb', {
            defaultValue:
              "This feature runs inside the ShieldBattery client, along with a few things the browser can't do.",
          })}
        </Subtitle>

        <Features>
          <FeatureCard>
            <FeatureIcon icon='military_tech' size={30} />
            <FeatureText>
              <FeatureTitle>
                {t('clientDownload.onlyInAppRankedTitle', 'Ranked matchmaking')}
              </FeatureTitle>
              <FeatureDescription>
                {t(
                  'clientDownload.onlyInAppRankedDescription',
                  '1v1 and team queues with seasonal MMR and placements.',
                )}
              </FeatureDescription>
            </FeatureText>
          </FeatureCard>
          <FeatureCard>
            <FeatureIcon icon='bolt' size={30} />
            <FeatureText>
              <FeatureTitle>
                {t('clientDownload.onlyInAppNetcodeTitle', 'Improved netcode')}
              </FeatureTitle>
              <FeatureDescription>
                {t(
                  'clientDownload.onlyInAppNetcodeDescription',
                  'Lower latency and fewer stalls, even on spotty connections.',
                )}
              </FeatureDescription>
            </FeatureText>
          </FeatureCard>
          <FeatureCard>
            <FeatureIcon icon='smart_display' size={30} />
            <FeatureText>
              <FeatureTitle>
                {t('clientDownload.onlyInAppReplaysTitle', 'Fast replay launching')}
              </FeatureTitle>
              <FeatureDescription>
                {t(
                  'clientDownload.onlyInAppReplaysDescription',
                  'Open any replay straight into StarCraft in seconds.',
                )}
              </FeatureDescription>
            </FeatureText>
          </FeatureCard>
        </Features>

        <Actions>
          <FilledButton
            onClick={navigateToDownload}
            iconStart={<MaterialIcon icon='download' size={20} />}
            label={
              <InstallerButtonLabel>
                {t('clientDownload.download', 'Download')}
              </InstallerButtonLabel>
            }
          />
          <TextButton
            onClick={() => push('/')}
            label={t('clientDownload.keepBrowsing', 'Keep browsing the web version')}
          />
          <WindowsNote>
            {t('clientDownload.windowsOnly', 'The app runs on Windows PCs.')}
          </WindowsNote>
        </Actions>
      </Content>
    </Root>
  )
}
