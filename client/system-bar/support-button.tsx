import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import GithubIcon from '../icons/brands/github.svg?react'
import KofiIcon from '../icons/brands/kofi-color.svg?react'
import PatreonIcon from '../icons/brands/patreon.svg?react'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { labelLarge } from '../styles/typography'

const SUPPORT_LINKS = [
  { name: 'GitHub Sponsors', url: 'https://github.com/sponsors/ShieldBattery', Icon: GithubIcon },
  { name: 'Patreon', url: 'https://patreon.com/tec27', Icon: PatreonIcon },
  { name: 'Ko-fi', url: 'https://ko-fi.com/tec27', Icon: KofiIcon },
] as const

const Button = styled.button`
  ${buttonReset};
  ${labelLarge};

  height: 24px;
  padding: 0 12px 0 8px;

  display: flex;
  align-items: center;
  gap: 6px;

  border: 1px solid var(--theme-primary);
  border-radius: 12px;
  color: var(--color-blue80);
  -webkit-app-region: no-drag;

  &:hover {
    background-color: rgb(from var(--color-blue80) r g b / 0.08);
  }

  &:active {
    background-color: rgb(from var(--color-blue80) r g b / 0.12);
  }
`

const StyledMenuList = styled(MenuList)`
  --sb-menu-min-width: 192px;
`

const BrandIcon = styled.div`
  width: 20px;
  height: 20px;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--theme-on-surface);
  fill: currentColor;

  & > svg {
    width: 100%;
    height: 100%;
  }
`

export function SupportButton() {
  const { t } = useTranslation()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <Button ref={anchor} onClick={openMenu}>
        <MaterialIcon icon='favorite' size={16} />
        <span>{t('systemBar.support', 'Support')}</span>
      </Button>
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={(anchorX ?? 0) + 4}
        anchorY={(anchorY ?? 0) + 4}
        originX='right'
        originY='top'>
        <StyledMenuList dense={true}>
          {SUPPORT_LINKS.map(({ name, url, Icon }) => (
            <MenuItem
              key={name}
              text={name}
              icon={
                <BrandIcon>
                  <Icon />
                </BrandIcon>
              }
              onClick={() => {
                window.open(url, '_blank', 'noopener,noreferrer')
                closeMenu()
              }}
            />
          ))}
        </StyledMenuList>
      </Popover>
    </>
  )
}
