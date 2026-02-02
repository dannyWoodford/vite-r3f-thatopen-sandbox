import type { ModelEntry } from './useThatOpenFragments'

export function FragmentsRenderer({ models }: { models: ModelEntry[] }) {
  return (
    <>
      {models.map(({ modelId, object }) => (
        <primitive
          // eslint-disable-next-line react/no-unknown-property
          key={modelId}
          object={object}
        />
      ))}
    </>
  )
}

