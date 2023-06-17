import { rgba } from 'polished'
import React, { ReactNode, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { DISCORD_URL } from '../../common/url-constants'
import { apiUrl } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import DiscordIcon from '../icons/brands/discord-lockup.svg'
import GithubIcon from '../icons/brands/github.svg'
import PatreonIcon from '../icons/brands/patreon-lockup.svg'
import TwitterIcon from '../icons/brands/twitter.svg'
import { AutoSizeMaterialIcon } from '../icons/material/material-icon'
import LogoText from '../logos/logotext-640x100.svg'
import { Label, RaisedButton } from '../material/button'
import Card from '../material/card'
import { linearOutSlowIn } from '../material/curve-constants'
import { push } from '../navigation/routing'
import { makePublicAssetUrl } from '../network/server-url'
import { useAppDispatch } from '../redux-hooks'
import {
  amberA400,
  background700,
  background800,
  background900,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { headline3, headline4, headline5, subtitle1 } from '../styles/typography'
import { BottomLinks } from './bottom-links'
import ChatImage from './chat.svg'
import TacticallyFaithfulImage from './tactically-faithful.svg'
import { TopLinks } from './top-links'

const SplashContainer = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: ${background700};
  margin: 0px auto;
  padding-right: var(--pixel-shove-x, 0) !important;
  overflow: auto scroll;

  & * {
    user-select: text;
  }
`

const BackgroundVideo = styled.video`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: 860px;
  object-fit: cover;
`

const BackgroundVideoScrim = styled.div`
  position: absolute;
  width: 100%;
  top: 0;
  left: 0;
  /*
    This should be at least BackgroundVideo's height + blur distance, I added a bit extra to be
    safe
  */
  height: 880px;
  background: linear-gradient(
    to bottom,
    ${rgba(background700, 0.6)} 50%,
    ${rgba(background700, 1)} 96%
  );
`

const LogoLockup = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  position: relative;
  margin: 20px 8px;
  pointer-events: none;
`

const Logo = styled.img`
  width: 128px;
  height: 128px;
  margin: 0 8px;
`

const StyledLogoText = styled(LogoText)`
  width: 320px;
  height: 50px;
  margin: 0 8px;
  margin-top: 6px; /* correct for baseline alignment */
`

const TagLine = styled.div`
  ${headline3};
  position: relative;
  margin: 16px 0px;
  padding: 0 16px;
  text-align: center;
`

const Blurb = styled.div`
  ${headline5};
  max-width: 740px;

  color: ${colorTextSecondary};
  position: relative;
  margin: 0px 0px 16px;
  padding: 0 16px;
`

const NoBreakText = styled.span`
  white-space: nowrap;
`

const ButtonsContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
`

const SplashButton = styled(RaisedButton)`
  width: 200px;
  height: 54px;
  margin: 16px 32px;

  & ${Label} {
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 1.4px;
  }
`

const BenefitContainer = styled.div`
  width: 100%;
  max-width: 1024px;
  padding: 40px 16px;
  contain: content;

  display: grid;
  grid-column-gap: 40px;
  grid-row-gap: 64px;
  grid-template-columns: repeat(12, 1fr);
  align-items: center;

  @media screen and (max-width: 800px) {
    grid-template-columns: repeat(8, 1fr);
  }
`

const BenefitCard = styled(Card)`
  grid-column: auto / span 8;
  padding: 24px;
`

const benefitIconCss = css`
  width: 100%;
  height: auto;
  grid-column: auto / span 4;
  padding: 24px;
  margin: auto;

  @media screen and (max-width: 800px) {
    display: none;
  }
`

const StyledChatImage = styled(ChatImage)`
  ${benefitIconCss};
`

const StyledLockOpenIcon = styled(AutoSizeMaterialIcon).attrs({ icon: 'lock_open', filled: false })`
  ${benefitIconCss};
  width: 80%; /* give this even visual weight with the other icons */
  color: ${amberA400};
`

const StyledTacticallyFaithfulImage = styled(TacticallyFaithfulImage)`
  ${benefitIconCss};
`

const BenefitTitle = styled.div`
  ${headline3};
`

const BenefitBody = styled.div`
  & > p {
    ${headline5};
    color: ${colorTextSecondary};
    font-weight: 300;
    margin: 20px 0 8px;
  }

  & > p + p {
    margin-top: 12px;
  }
`

interface BenefitSectionProps {
  title: string
  body: ReactNode
  image: React.ReactElement
  imageAtStart: boolean
}

const BenefitSection = ({ title, body, image, imageAtStart }: BenefitSectionProps) => {
  return (
    <React.Fragment>
      {imageAtStart ? image : null}
      <BenefitCard>
        <BenefitTitle>{title}</BenefitTitle>
        <BenefitBody>{body}</BenefitBody>
      </BenefitCard>
      {imageAtStart ? null : image}
    </React.Fragment>
  )
}

const FeatureContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding-top: 40px;
  padding-bottom: 40px;
  background-color: ${background800};
`

const FeatureSection = styled.div`
  width: 100%;
  max-width: 1000px;
  padding: 0 8px;

  & + & {
    margin-top: 80px;
  }
`

const FeatureSectionTitle = styled.div`
  ${headline4};
  margin-left: 16px;
`

const FeatureSectionList = styled.dl`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 32px;
  row-gap: 40px;
  padding-left: 16px;
  margin: 24px 0;

  @media screen and (max-width: 800px) {
    grid-template-columns: 1fr;
  }

  & dt {
    ${headline5};
    font-weight: 300;
  }

  & dd {
    ${headline5};
    color: ${colorTextSecondary};
    font-weight: 300;
    margin: 0;
  }
`

const ComingSoonText = styled.span`
  ${headline4};
  color: ${colorTextSecondary};
`

const FeatureEntryContainer = styled.div`
  grid-column: auto / span 1;
`

interface FeatureEntryProps {
  className?: string
  title: string
  description: string
}

function FeatureEntry({ className, title, description }: FeatureEntryProps) {
  return (
    <FeatureEntryContainer className={className}>
      <dt>{title}</dt>
      <dd>{description}</dd>
    </FeatureEntryContainer>
  )
}

const LinksSection = styled.div`
  width: 100%;
  max-width: 1000px;
  padding: 40px 24px;
  background-color: ${background700};
`

const LinksHeader = styled.div`
  ${headline4};
`

const LinkEntries = styled.div`
  display: flex;
  align-items: center;
  margin-top: 16px;
  /** Offset for the inner padding of the first item */
  margin-left: -16px;

  a,
  a:link,
  a:visited {
    height: 48px;
    display: flex;
    align-items: center;
    color: ${colorTextSecondary};
    padding-left: 16px;
    padding-right: 16px;
    overflow: hidden;

    &:hover,
    &:active {
      color: ${colorTextPrimary};
    }
  }
`

const DisclaimerSection = styled.div`
  width: 100%;
  background-color: ${background900};
`

const DisclaimerText = styled.div`
  ${subtitle1};
  width: 100%;
  max-width: 1000px;
  padding: 40px 24px;
  margin: 0 auto;
  color: ${colorTextSecondary};
`

const StyledDiscordIcon = styled(DiscordIcon)`
  height: 48px;
  margin-top: 4px;
`

const StyledGithubIcon = styled(GithubIcon)`
  height: 40px;
`

const StyledPatreonIcon = styled(PatreonIcon)`
  height: 24px;
`

const StyledTwitterIcon = styled(TwitterIcon)`
  height: 32px;
`

if ((window.CSS as any).registerProperty) {
  try {
    ;(window.CSS as any).registerProperty({
      name: '--sb-game-count',
      syntax: '<integer>',
      initialValue: 0,
      inherits: false,
    })
  } catch (err) {
    // We don't really care about errors here, the count just won't animate and that's fine. Often
    // this occurs just because of hot-reloading so it isn't even really an error
  }
}

const GameCountNumber = styled.span`
  transition: --sb-game-count 2s ${linearOutSlowIn};
  counter-reset: game-count var(--sb-game-count, 0);

  &::after {
    content: counter(game-count);
  }
`

function GameCount(props: { className?: string }) {
  const { t } = useTranslation()
  const [gameCount, setGameCount] = useState(0)

  useEffect(() => {
    const eventSource = new EventSource(apiUrl`games`)

    eventSource.addEventListener('gameCount', event => {
      setGameCount((event as any).data)
    })

    return () => eventSource.close()
  }, [])

  return (
    <div className={props.className}>
      <Trans t={t} i18nKey='landing.splash.gameCount'>
        <GameCountNumber style={{ '--sb-game-count': gameCount } as any} /> games played
      </Trans>
    </div>
  )
}

const StyledGameCount = styled(GameCount)`
  ${headline4};
  font-weight: 300;
  margin: 32px 0 16px;
  text-align: right;
  z-index: 1;
`

export function Splash() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const onSignUpClick = () => push({ pathname: '/signup' })

  const BENEFITS: Readonly<Array<Omit<BenefitSectionProps, 'imageAtStart'>>> = [
    {
      title: t('landing.splash.benefits.communityFirstTitle', 'Community first'),
      body: (
        <p key='p1'>
          <Trans t={t} i18nKey='landing.splash.benefits.communityFirstText'>
            ShieldBattery is a vibrant hub for everyone who plays or watches StarCraft. Chat is
            front and center, getting into games is seamless and easy, and your experience is our
            top concern. Whether you've been playing since 1998 or just picked up the game this
            week, you'll find a home here.
          </Trans>
        </p>
      ),
      image: <StyledChatImage aria-label='' />,
    },
    {
      title: t('landing.splash.benefits.tacticallyFaithfulTitle', 'Tactically faithful'),
      body: (
        <p key='p1'>
          <Trans t={t} i18nKey='landing.splash.benefits.tacticallyFaithfulText'>
            Built by community members with collective decades of StarCraft experience, we know what
            makes the game tick. We're keeping the important things the same, but building out brand
            new features and improvements to make your StarCraft experience better than ever.
          </Trans>
        </p>
      ),
      image: <StyledTacticallyFaithfulImage aria-label='' />,
    },
    {
      title: t('landing.splash.benefits.fullPotentialTitle', 'Full potential unlocked'),
      body: (
        <p key='p1'>
          <Trans t={t} i18nKey='landing.splash.benefits.fullPotentialText'>
            StarCraft has an amazing competitive history, and ShieldBattery is a foundation for
            delivering the top-notch playing and watching experience it deserves. Open-source,
            community-driven, and set to deliver features and experiences that even modern games
            wish they could have: ShieldBattery is a revolutionary step forward for the StarCraft
            community.
          </Trans>
        </p>
      ),
      image: <StyledLockOpenIcon aria-label='' />,
    },
  ]

  return (
    <SplashContainer>
      <BackgroundVideo playsInline={true} autoPlay={true} muted={true} loop={true}>
        <source src={makePublicAssetUrl('/videos/splash-video.mp4')} type='video/mp4' />
      </BackgroundVideo>
      <BackgroundVideoScrim />
      <TopLinks />
      <LogoLockup>
        <Logo src={makePublicAssetUrl('/images/logo.svg')} />
        <StyledLogoText />
      </LogoLockup>
      <TagLine>
        {t('landing.splash.tagline', 'Play StarCraft 1 on the premier community-run platform')}
      </TagLine>
      <Blurb>
        <Trans t={t} i18nKey='landing.splash.blurb'>
          ShieldBattery is the first community-run server that supports{' '}
          <NoBreakText>StarCraft: Remastered.</NoBreakText> Our custom launcher enhances the real
          game client to work with our advanced platform, improving on the StarCraft 1 experience
          while maintaining faithful, authentic gameplay. Download our launcher and start playing in
          just a few clicks!
        </Trans>
      </Blurb>
      {!IS_ELECTRON ? (
        <ButtonsContainer>
          <SplashButton
            label={t('landing.splash.signUp', 'Sign Up')}
            color='primary'
            onClick={onSignUpClick}
            testName='sign-up-button'
          />
          <SplashButton
            label={t('common.actions.download', 'Download')}
            color='primary'
            onClick={() => dispatch(openDialog({ type: DialogType.Download }))}
          />
        </ButtonsContainer>
      ) : (
        <SplashButton
          label={t('landing.splash.signUp', 'Sign Up')}
          color='primary'
          onClick={onSignUpClick}
          testName='sign-up-button'
        />
      )}
      <StyledGameCount />
      <BenefitContainer>
        {BENEFITS.map((f, i) => (
          <BenefitSection
            title={f.title}
            body={f.body}
            image={f.image}
            imageAtStart={i % 2 !== 0}
            key={`feature-${i}`}
          />
        ))}
      </BenefitContainer>
      <FeatureContainer>
        <FeatureSection>
          <FeatureSectionTitle>{t('landing.splash.featuresTitle', 'Features')}</FeatureSectionTitle>
          <FeatureSectionList>
            <FeatureEntry
              title={t('landing.splash.features.matchmakingTitle', '1v1 and 2v2 Matchmaking')}
              description={t(
                'landing.splash.features.matchmakingDescription',
                'Find matches quickly and easily, by yourself or with an arranged team.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.features.rankedLadderTitle', 'Ranked ladder')}
              description={t(
                'landing.splash.features.rankedladderDescription',
                'Hone your skills in our Glicko-based ranking system for all matchmaking modes.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.features.leaguesTitle', 'Open Leagues')}
              description={t(
                'landing.splash.features.leaguesDescription',
                'Participate in exciting limited-time leagues organized by the community and ' +
                  'facilitated by automated matchmaking.',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.features.remasteredSupportTitle',
                'StarCraft: Remastered support',
              )}
              description={t(
                'landing.splash.features.remasteredSupportDescription',
                'Support for all the new Remastered features, including HD graphics (if ' +
                  'purchased from Blizzard) and custom hotkeys.',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.features.fixesBugsExploitsTitle',
                'Fixes for bugs and exploits',
              )}
              description={t(
                'landing.splash.features.fixesBugsExploitsDescription',
                'Avoid the hacks and exploits that plague the official servers. ' +
                  'Things like worker duplication, mineral hacks, and permanently floating ' +
                  'workers are a thing of the past here.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.features.friendsListTitle', 'Friends list')}
              description={t(
                'landing.splash.features.friendsListDescription',
                'Track when your friends are online, easily send them messages and invite them ' +
                  'to games.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.features.improvedNetcodeTitle', 'Improved netcode')}
              description={t(
                'landing.splash.features.improvedNetcodeDescription',
                'Less lag, drops, and packet loss!',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.features.teamMeleeReplaysTitle',
                'Working Team Melee replays',
              )}
              description={t(
                'landing.splash.features.teamMeleeReplaysDescription',
                'Play back any games played in Team Melee mode on ShieldBattery!',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.features.partiesTitle', 'Parties')}
              description={t(
                'landing.splash.features.partiesDescription',
                'Party up with your friends to easily host private matches, watch replays ' +
                  'together, or join matchmaking.',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.features.cloudHostingTitle',
                'Cloud-based map distribution and hosting',
              )}
              description={t(
                'landing.splash.features.cloudHostingDescription',
                'Play on any of the maps in our official library, or upload your own. Upload ' +
                  'all your favorite maps, share them with your friends, host them from anywhere.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.features.webClientTitle', 'Web-based chat client')}
              description={t(
                'landing.splash.features.webClientDescription',
                'Keep up with your friends (and enemies) without needing to install anything.',
              )}
            />
          </FeatureSectionList>
        </FeatureSection>
        <FeatureSection>
          <FeatureSectionTitle>
            <Trans t={t} i18nKey='landing.splash.comingSoonTitle'>
              In the pipe <ComingSoonText>(coming soon)</ComingSoonText>
            </Trans>
          </FeatureSectionTitle>
          <FeatureSectionList>
            <FeatureEntry
              title={t('landing.splash.comingSoon.3v3Title', '3v3 matchmaking')}
              description={t(
                'landing.splash.comingSoon.3v3Description',
                'Easily find games for 3v3, with arranged or random teams.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.cloudReplaysTitle', 'Cloud-synced replays')}
              description={t(
                'landing.splash.comingSoon.cloudReplaysDescription',
                'Automatic uploading for replays. Share them with others, watch them from ' +
                  'anywhere!',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.pixelScalingTitle', 'Configurable pixel scaling')}
              description={t(
                'landing.splash.comingSoon.pixelScalingDescription',
                'Improve the look of SD graphics on modern screens with custom scaling algorithms',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.liveStreamingTitle', 'Live match streaming')}
              description={t(
                'landing.splash.comingSoon.liveStreamingDescription',
                'Jump into in-progress matches and watch them live, with all the benefits of ' +
                  'ingame observing.',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.comingSoon.playerProfilesTitle',
                'Player profiles and statistics',
              )}
              description={t(
                'landing.splash.comingSoon.playerProfilesDescription',
                'Check out your skills across different matchups and maps, find ways to improve, ' +
                  'and see how you stack up against the competition.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.replayAnalysisTitle', 'Replay analysis')}
              description={t(
                'landing.splash.comingSoon.replayAnalysisDescription',
                'Built-in support for BWChart-like replay analysis, as well as more advanced ' +
                  'statistics and charting.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.fpReplaysTitle', 'First person replays')}
              description={t(
                'landing.splash.comingSoon.fpReplaysDescription',
                'Record mouse and screen movements and play them back for all players.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.sandboxModeTitle', 'Training/sandbox mode')}
              description={t(
                'landing.splash.comingSoon.sandboxModeDescription',
                'Test out new builds, practice your worker split, improve your micro.',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.comingSoon.builtInMapmakingTitle',
                'New built-in mapmaking features',
              )}
              description={t(
                'landing.splash.comingSoon.builtInMapmakingDescription',
                'Destructible rocks, ideal worker starting positions, advanced creep placement, ' +
                  'and more!',
              )}
            />
            <FeatureEntry
              title={t(
                'landing.splash.comingSoon.automatedTournamentsTitle',
                'Automated tournaments and leagues',
              )}
              description={t(
                'landing.splash.comingSoon.automatedTournamentsDescription',
                'Find tournaments and leagues that match your skill level, run automatically.',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.expandedChatTitle', 'Expanded chat features')}
              description={t(
                'landing.splash.comingSoon.expandedChatDescription',
                'Express yourself using emotes, embed maps, matches, and replays, and more!',
              )}
            />
            <FeatureEntry
              title={t('landing.splash.comingSoon.umsPortalTitle', 'Use Map Settings portal')}
              description={t(
                'landing.splash.comingSoon.umsPortalDescription',
                'Find and explore UMS maps with ease, then quickly gather players and get the ' +
                  'game started.',
              )}
            />
          </FeatureSectionList>
        </FeatureSection>
      </FeatureContainer>
      <LinksSection>
        <LinksHeader>{t('landing.splash.linksHeader', 'Links')}</LinksHeader>
        <LinkEntries>
          <a
            href='https://twitter.com/ShieldBatteryBW'
            title='Twitter'
            target='_blank'
            rel='noopener'>
            <StyledTwitterIcon />
          </a>
          <a
            href='https://github.com/ShieldBattery/ShieldBattery'
            title='GitHub'
            target='_blank'
            rel='noopener'>
            <StyledGithubIcon />
          </a>
          <a href={DISCORD_URL} title='Discord' target='_blank' rel='noopener'>
            <StyledDiscordIcon />
          </a>
          <a href='https://patreon.com/tec27' title='Patreon' target='_blank' rel='noopener'>
            <StyledPatreonIcon />
          </a>
        </LinkEntries>
      </LinksSection>
      <DisclaimerSection>
        <DisclaimerText>
          <Trans t={t} i18nKey='landing.splash.disclaimerText'>
            StarCraft is a registered trademark of Blizzard Entertainment, Inc. ShieldBattery is
            developed solely by members of the community, unaffiliated with Blizzard, and is not
            officially endorsed or supported by Blizzard.
          </Trans>
        </DisclaimerText>
      </DisclaimerSection>
      <BottomLinks />
    </SplashContainer>
  )
}
