import { styled } from 'styled-components'
import { colorDividers, colorTextFaint, colorTextSecondary } from '../styles/colors.js'
import { overline, singleLine, subtitle2 } from '../styles/typography.js'

export const RegularSlots = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
`

export const ObserverSlots = styled.div`
  width: 100%;
  display: flex;
  flex-wrap: wrap;
`

export const Slot = styled.div`
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 24px;

  ${ObserverSlots} > & {
    width: 50%;
    padding-right: 8px;
  }
`

export const SlotLeft = styled.div`
  display: flex;
  justify-content: space-between;

  ${RegularSlots} & {
    width: 50%;
    padding-right: 8px;
  }

  ${ObserverSlots} & {
    width: 100%;
  }
`

export const SlotRight = styled.div`
  width: 50%;
  min-width: 156px;
  display: flex;
  flex-grow: 0;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-start;

  ${ObserverSlots} & {
    /* TODO(tec27): can we just use display: none here? */
    width: 0px;
    min-width: 0px;
    padding-right: 0px;
  }
`

export const TeamName = styled.div`
  ${overline};
  ${singleLine};
  line-height: 24px;
  height: 24px;
  display: block;
  color: ${colorTextSecondary};

  ${Slot} + & {
    margin-top: 8px;
  }
`

export const SlotProfile = styled.div`
  display: flex;
  flex-grow: 1;
  align-items: center;
  margin-right: 8px;
`

export const SlotProfileOpen = styled(SlotProfile)`
  cursor: pointer;
`

export const SlotEmptyAvatar = styled.span`
  /* extra size accounts for border */
  width: 26px;
  height: 26px;
  flex-grow: 0;
  flex-shrink: 0;
  margin-right: 16px;

  border-radius: 50%;
  border: 1px solid ${colorDividers};
  text-align: center;
  color: ${colorTextSecondary};
`

export const SlotName = styled.div`
  ${subtitle2};
  ${singleLine};
  max-width: 256px;
  flex-grow: 1;
  flex-shrink: 1;
  margin-right: 8px;
`

export const SlotEmptyName = styled(SlotName)`
  color: ${colorTextFaint};
`
