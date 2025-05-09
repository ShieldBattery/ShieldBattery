import React, { Suspense, useImperativeHandle, useRef, useState } from 'react'
import styled from 'styled-components'
import { IterableElement } from 'type-fest'
import { useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { graphql } from '../gql'
import { RestrictedNameKind, RestrictedNameReason, RestrictedNamesQuery } from '../gql/graphql'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import DotsIndicator, { LoadingDotsArea } from '../progress/dots'
import { useFuzzyFilter } from '../search/use-fuzzy'
import { CenteredContentContainer } from '../styles/centered-container'
import { BodyLarge, bodyLarge, LabelLarge, titleLarge, TitleMedium } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const Root = styled.div`
  padding-block: 24px;

  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: auto min-content min-content 1fr;
  column-gap: 40px;
  row-gap: 16px;
`

const Title = styled.div`
  ${titleLarge};
  grid-column: 1 / -1;
`

const ListLoadingArea = styled(LoadingDotsArea)`
  grid-column: span 3;
  grid-row: 2 / -1;
`

export function RestrictedNames() {
  const listRef = useRef<RestrictedNamesListController>(null)

  return (
    <CenteredContentContainer>
      <Root>
        <Title>Restricted Names</Title>
        <Suspense fallback={<ListLoadingArea />}>
          <RestrictedNamesList ref={listRef} />
        </Suspense>
        <TestForm onFilterMatch={pattern => listRef.current?.setFilter(pattern)} />
        <AddForm />
      </Root>
    </CenteredContentContainer>
  )
}

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const ListRoot = styled.div`
  grid-column: span 3;
  grid-row: 2 / -1;
  display: flex;
  flex-direction: column;
`

const FilterAndRefresh = styled.div`
  display: flex;
  align-items: center;
  gap: 40px;
`

const FilterInput = styled(TextField)`
  flex-grow: 1;
`

const RestrictedNamesListQuery = graphql(/* GraphQL */ `
  query RestrictedNames {
    restrictedNames {
      id
      pattern
      kind
      reason
      createdAt
      createdBy {
        id
      }
    }
  }
`)

const DeleteRestrictedNameMutation = graphql(/* GraphQL */ `
  mutation DeleteRestrictedName($id: Int!) {
    userDeleteRestrictedName(id: $id)
  }
`)

interface RestrictedNamesListController {
  setFilter: (filter: string) => void
}

function RestrictedNamesList({ ref }: { ref: React.Ref<RestrictedNamesListController> }) {
  const [filter, setFilter] = useState('')
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<number>()
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: RestrictedNamesListQuery,
  })
  const [{ fetching, error: deleteError }, deleteRestrictedName] = useMutation(
    DeleteRestrictedNameMutation,
  )

  const items = useFuzzyFilter(data?.restrictedNames ?? [], filter.trim(), n => n.pattern)

  useImperativeHandle(ref, () => ({
    setFilter,
  }))

  const performDelete = (id: number) => {
    deleteRestrictedName({ id })
      .catch(swallowNonBuiltins)
      .finally(() => {
        setConfirmDeleteFor(undefined)
      })
  }

  return (
    <ListRoot>
      <FilterAndRefresh>
        <FilterInput
          label='Filter'
          dense={true}
          allowErrors={false}
          value={filter}
          onChange={event => setFilter(event.target.value)}
          hasClearButton={true}
        />
        <IconButton
          icon={<MaterialIcon icon='refresh' />}
          title='Refresh'
          onClick={() => reexecuteQuery({ requestPolicy: 'network-only' })}
          disabled={fetching}
        />
      </FilterAndRefresh>
      {error ? <ErrorText>Error loading restricted names: {error.message}</ErrorText> : null}
      {deleteError ? (
        <ErrorText>Error deleting restricted name: {deleteError.message}</ErrorText>
      ) : null}
      {items.map(item => (
        <RestrictedNameEntry
          key={item.id}
          item={item}
          onStartDelete={() => setConfirmDeleteFor(item.id)}
          confirmDelete={item.id === confirmDeleteFor}
          onCancelDelete={() => setConfirmDeleteFor(undefined)}
          onConfirmDelete={() => performDelete(item.id)}
          fetching={fetching}
        />
      ))}
    </ListRoot>
  )
}

const RestrictedNameEntryRoot = styled.div`
  min-height: 68px;
  padding: 8px;

  display: flex;
  align-items: center;
  gap: 16px;
`

const DeleteButton = styled(IconButton)`
  visibility: hidden;

  ${RestrictedNameEntryRoot}:hover &, ${RestrictedNameEntryRoot}:focus-within & {
    visibility: visible;
  }
`

function KindDisplay({ kind }: { kind: RestrictedNameKind }) {
  switch (kind) {
    case RestrictedNameKind.Exact:
      return <LabelLarge style={{ color: 'var(--color-grey-blue90)' }}>Exact</LabelLarge>
    case RestrictedNameKind.Regex:
      return <LabelLarge style={{ color: 'var(--color-purple90)' }}>Regex</LabelLarge>
    default:
      return kind satisfies never
  }
}

function ReasonDisplay({ reason }: { reason: RestrictedNameReason }) {
  switch (reason) {
    case RestrictedNameReason.Profanity:
      return <LabelLarge style={{ color: 'var(--theme-negative)' }}>Profanity</LabelLarge>
    case RestrictedNameReason.Reserved:
      return <LabelLarge style={{ color: 'var(--color-amber70)' }}>Reserved</LabelLarge>
    default:
      return reason satisfies never
  }
}

const KindAndReasonDisplay = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`

const Spacer = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
`

const CreationInfo = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  color: var(--theme-on-surface-variant);
`

function RestrictedNameEntry({
  item: { pattern, kind, reason, createdAt, createdBy },
  onStartDelete,
  confirmDelete,
  onCancelDelete,
  onConfirmDelete,
  fetching,
}: {
  item: IterableElement<RestrictedNamesQuery['restrictedNames']>
  onStartDelete: () => void
  confirmDelete: boolean
  onCancelDelete: () => void
  onConfirmDelete: () => void
  fetching: boolean
}) {
  return (
    <RestrictedNameEntryRoot>
      {confirmDelete ? (
        <>
          <BodyLarge>Are you sure you want to delete this restricted name?</BodyLarge>
          <Spacer />
          <TextButton label='Cancel' onClick={onCancelDelete} disabled={fetching} />
          <TextButton label='Delete' onClick={onConfirmDelete} disabled={fetching} />
        </>
      ) : (
        <>
          <div>
            <TitleMedium>{pattern}</TitleMedium>
            <KindAndReasonDisplay>
              <KindDisplay kind={kind} /> ·
              <ReasonDisplay reason={reason} />
            </KindAndReasonDisplay>
          </div>
          <Spacer />
          <CreationInfo>
            {createdBy ? <ConnectedUsername userId={createdBy.id} /> : <div />}
            <div>{longTimestamp.format(new Date(createdAt))}</div>
          </CreationInfo>
          <DeleteButton
            icon={<MaterialIcon icon='delete' />}
            title='Delete'
            onClick={onStartDelete}
            disabled={fetching}
          />
        </>
      )}
    </RestrictedNameEntryRoot>
  )
}

const AddFormRoot = styled.form`
  grid-column: span 2;
  padding: 8px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const KindAndReasonInputs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
`

const AddRestrictedNameMutation = graphql(/* GraphQL */ `
  mutation AddRestrictedName(
    $pattern: String!
    $kind: RestrictedNameKind!
    $reason: RestrictedNameReason!
  ) {
    userAddRestrictedName(pattern: $pattern, kind: $kind, reason: $reason) {
      id
      pattern
      kind
      reason
      createdAt
      createdBy {
        id
      }
    }
  }
`)

interface AddRestrictedNameForm {
  pattern: string
  kind: RestrictedNameKind
  reason: RestrictedNameReason
}

function AddForm() {
  const [{ fetching, error }, addRestrictedName] = useMutation(AddRestrictedNameMutation)

  const defaults: AddRestrictedNameForm = {
    pattern: '',
    kind: RestrictedNameKind.Exact,
    reason: RestrictedNameReason.Profanity,
  }

  const { submit, bindInput, form } = useForm(defaults, {})

  useFormCallbacks(form, {
    onSubmit: model => {
      addRestrictedName(model).catch(swallowNonBuiltins)
    },
  })

  return (
    <AddFormRoot onSubmit={submit}>
      <LabelLarge>Add name</LabelLarge>
      {error ? <ErrorText>Error adding restricted name: {error.message}</ErrorText> : null}
      <TextField
        {...bindInput('pattern')}
        label='Pattern'
        disabled={fetching}
        dense={true}
        allowErrors={false}
      />
      <KindAndReasonInputs>
        <div>
          <RadioGroup {...bindInput('kind')} label='Kind' dense={true}>
            <RadioButton value={RestrictedNameKind.Exact} label='Exact' disabled={fetching} />
            <RadioButton value={RestrictedNameKind.Regex} label='Regex' disabled={fetching} />
          </RadioGroup>
        </div>
        <div>
          <RadioGroup {...bindInput('reason')} label='Reason' dense={true}>
            <RadioButton
              value={RestrictedNameReason.Profanity}
              label='Profanity'
              disabled={fetching}
            />
            <RadioButton
              value={RestrictedNameReason.Reserved}
              label='Reserved'
              disabled={fetching}
            />
          </RadioGroup>
        </div>
      </KindAndReasonInputs>
      <FilledButton label='Add' onClick={submit} disabled={fetching} />
    </AddFormRoot>
  )
}

const TestFormRoot = styled.form`
  grid-column: span 2;
  padding: 8px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const TextFieldAndButton = styled.div`
  display: flex;
  gap: 8px;
`

const TestResults = styled.div<{ $hasMatch?: boolean }>`
  ${bodyLarge};
  width: 100%;
  height: 32px;
  overflow: hidden;

  display: flex;
  align-items: center;
  gap: 8px;

  cursor: ${props => (props.$hasMatch ? 'pointer' : 'unset')};
`

const AllowedIcon = styled(MaterialIcon)`
  color: var(--theme-positive);
`

const RestrictedIcon = styled(MaterialIcon)`
  color: var(--theme-negative);
`

const TestRestrictedNameMutation = graphql(/* GraphQL */ `
  mutation TestRestrictedName($name: String!) {
    userTestRestrictedName(name: $name) {
      id
      pattern
      kind
      reason
    }
  }
`)

interface TestNameForm {
  name: string
}

function TestForm({ onFilterMatch }: { onFilterMatch: (pattern: string) => void }) {
  const [{ fetching, data }, testRestrictedName] = useMutation(TestRestrictedNameMutation)

  const defaults: TestNameForm = {
    name: '',
  }

  const { submit, bindInput, form } = useForm(defaults, {})

  useFormCallbacks(form, {
    onSubmit: model => {
      testRestrictedName(model).catch(swallowNonBuiltins)
    },
  })

  return (
    <TestFormRoot onSubmit={submit}>
      <LabelLarge>Name tester</LabelLarge>
      <TextFieldAndButton>
        <TextField {...bindInput('name')} label='Test name' dense={true} allowErrors={false} />
        <FilledButton label='Test' onClick={submit} />
      </TextFieldAndButton>
      <TestResults
        $hasMatch={!!data?.userTestRestrictedName}
        onClick={() => {
          if (data?.userTestRestrictedName) {
            onFilterMatch(data.userTestRestrictedName.pattern)
          }
        }}>
        {fetching ? (
          <DotsIndicator />
        ) : (
          <>
            {data?.userTestRestrictedName ? (
              <>
                <RestrictedIcon icon='block' />
                <TitleMedium>{data.userTestRestrictedName.pattern}</TitleMedium>
                <KindDisplay kind={data.userTestRestrictedName.kind} />
              </>
            ) : (
              <>
                <AllowedIcon icon='check_circle' />
                <div>Name is allowed</div>
              </>
            )}
          </>
        )}
      </TestResults>
    </TestFormRoot>
  )
}
