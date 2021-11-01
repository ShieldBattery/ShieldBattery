import React from 'react'
import styled, { css } from 'styled-components'
import CloseIcon from '../icons/material/ic_close_black_24px.svg'
import { IconButton, TextButton } from '../material/button'
import { Checkbox } from '../material/checkable-input'
import { background600, colorTextSecondary } from '../styles/colors'

const LIST_ITEM_HEIGHT = 36

const unstyledList = css`
  margin: 0;
  padding: 0;
  list-style: none;
`

const ListItem = styled.li`
  height: ${LIST_ITEM_HEIGHT}px;
  margin: 0;
  padding-right: 12px;

  display: flex;
  justify-content: space-between;
  justify-content: flex-start;
  align-items: center;

  color: white;

  &:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.06);
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.12);
  }

  & > span {
    text-overflow: ellipsis;
    overflow: hidden;
    min-width: 0;
    user-select: text;
  }
`

const RemoveItemButton = styled(IconButton)`
  height: ${LIST_ITEM_HEIGHT * 0.85}px;
  width: ${LIST_ITEM_HEIGHT * 0.85}px;
  min-width: auto;
  min-height: auto;
  opacity: 0.25;
  transition: none;

  ${ListItem}:hover & {
    opacity: 1;
  }

  ${ListItem} & {
    flex-grow: 0;
    flex-shrink: 0;
    margin: 0 6px;
  }
`

const HostList = styled.ul`
  ${unstyledList}

  height: ${LIST_ITEM_HEIGHT * 3.75}px;
  overflow-y: auto;
  background: ${background600};
`

const RemoveHostsButton = styled(TextButton)``

const SettingsContainer = styled.div`
  /* Without this form markup breakes on very long hosts. 
  Another way to fix it - use "minmax()" instead of "1fr" on 
  FormContainer's template-columns */
  display: grid;

  & ${RemoveHostsButton} {
    width: fit-content;
  }
`

const CloseIconInst = <CloseIcon />

function HostItem(props: { host: string; onRemoveHostClick: (e: React.MouseEvent) => void }) {
  const { host, onRemoveHostClick } = props

  return (
    <ListItem title={host}>
      <RemoveItemButton
        icon={CloseIconInst}
        name={host}
        onClick={onRemoveHostClick}
        title='remove host'
      />
      <span>{host}</span>
    </ListItem>
  )
}

interface TrustedHostsListProps {
  onChange: (newValue: string[]) => void
  value: string[]
}

class TrustedHostsList extends React.PureComponent<TrustedHostsListProps> {
  removeHost = (e: React.MouseEvent) => {
    const { value: hosts, onChange } = this.props
    const hostId = (e.currentTarget as HTMLButtonElement).name
    const newHosts = hosts.filter(host => host !== hostId)
    onChange(newHosts)
  }

  removeAllHosts = () => {
    this.props.onChange([])
  }

  override render() {
    const { value: hosts } = this.props

    const noTrustedHosts = hosts.length === 0

    const listLabel = (
      <p style={{ color: colorTextSecondary }}>Trusted hosts: {noTrustedHosts && '(none)'}</p>
    )

    return (
      <>
        {listLabel}
        {!noTrustedHosts && (
          <HostList>
            {hosts.map(host => (
              <HostItem key={host} host={host} onRemoveHostClick={this.removeHost} />
            ))}
          </HostList>
        )}
        {!noTrustedHosts && (
          <RemoveHostsButton label='Remove all hosts' onClick={this.removeAllHosts} />
        )}
      </>
    )
  }
}

interface TrustedLinksSettingsProps {
  bindCustom: (name: string) => TrustedHostsListProps
  bindCheckable: (name: string) => Record<string, any>
}

export default function TrustedLinksSettings(props: TrustedLinksSettingsProps) {
  return (
    <SettingsContainer>
      <Checkbox
        {...props.bindCheckable('trustAllLinks')}
        label='Trust all chat links'
        inputProps={{
          tabIndex: 0,
          title: 'Checking this removes confirmation dialog for all external links in chat',
        }}
      />
      <TrustedHostsList {...props.bindCustom('trustedHosts')} />
    </SettingsContainer>
  )
}
