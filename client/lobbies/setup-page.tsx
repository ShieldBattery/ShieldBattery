import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { EllipsizedText } from '../material/ellipsized-text'
import { Tooltip } from '../material/tooltip'
import { bodySmall, titleLarge } from '../styles/typography'

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`

const FormScroller = styled.div<{ $hidden: boolean }>`
  flex-grow: 1;
  min-height: 0;
  contain: strict;
  overflow-y: auto;

  display: ${props => (props.$hidden ? 'none' : 'block')};
`

const Content = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

export const SetupPageTitle = styled.div`
  ${titleLarge};
`

const FooterBar = styled.div<{ $hidden: boolean }>`
  flex-shrink: 0;
  /* Slightly wider than the 960px form column (24px beyond it on each side, matching the page's
     24px padding rhythm) so the bar frames the column without stretching across the whole
     container. */
  width: 100%;
  max-width: 1008px;
  margin: 0 auto;
  /* The bar doesn't reach the window edges, so it's framed as a contained surface: bordered and
     slightly rounded on the exposed sides, square along the bottom edge it sits flush against. */
  border: 1px solid var(--theme-outline-variant);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background-color: var(--theme-container-low);

  display: ${props => (props.$hidden ? 'none' : 'block')};
`

const FooterContent = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 10px 24px;

  display: flex;
  align-items: center;
  gap: 16px;
`

const FooterStart = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const SummaryText = styled(EllipsizedText)`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

export interface SetupPageProps {
  title: string
  /** When set, a back arrow is shown next to the title. */
  onBack?: () => void
  /** One-line description of the current setup, shown in the footer bar. */
  summary?: string
  /**
   * Shown in the footer bar in place of the summary while set, e.g. why the server refused the
   * setup.
   */
  footerNotice?: React.ReactNode
  /**
   * Action button(s) for the footer bar. A page with no actions, summary or notice has no footer
   * bar at all.
   */
  footerActions?: React.ReactNode
  /**
   * Shown instead of the form and footer bar while set. The form stays mounted (but hidden)
   * underneath, so in-progress edits survive the round trip.
   */
  cover?: React.ReactNode
  children: React.ReactNode
}

/**
 * The scaffolding of a lobby's full-page setup forms: a title header (with an optional back arrow)
 * above a 960px column of sections, and a footer bar with a one-line summary of the setup and the
 * caller's action buttons. A page that only shows something, with nothing to sum up or act on,
 * leaves the footer bar out.
 */
export function SetupPage({
  title,
  onBack,
  summary,
  footerNotice,
  footerActions,
  cover,
  children,
}: SetupPageProps) {
  const { t } = useTranslation()
  const covered = !!cover
  const hasFooter =
    footerActions !== undefined || footerNotice !== undefined || summary !== undefined

  return (
    <Root>
      {cover}

      <FormScroller $hidden={covered}>
        <Content>
          <Header>
            {onBack ? (
              <Tooltip text={t('common.actions.back', 'Back')} position='bottom' tabIndex={-1}>
                <IconButton
                  icon={<MaterialIcon icon='arrow_back' />}
                  ariaLabel={t('common.actions.back', 'Back')}
                  onClick={onBack}
                  testName='setup-page-back-button'
                />
              </Tooltip>
            ) : null}

            <SetupPageTitle>{title}</SetupPageTitle>
          </Header>

          {children}
        </Content>
      </FormScroller>

      {hasFooter ? (
        <FooterBar $hidden={covered}>
          <FooterContent>
            <FooterStart>
              {footerNotice ?? (summary !== undefined ? <SummaryText text={summary} /> : null)}
            </FooterStart>
            {footerActions}
          </FooterContent>
        </FooterBar>
      ) : null}
    </Root>
  )
}
