import { useControls } from 'leva'
import { FragmentsRenderer } from './thatopen/FragmentsRenderer'
import { DeclarativeRecreatedElementsRenderer } from './thatopen/DeclarativeRecreatedElementsRenderer'
import { RecreatedElementsRenderer } from './thatopen/RecreatedElementsRenderer'
import { useThatOpenFragments } from './thatopen/useThatOpenFragments'

const FRAGMENT_URL =
  'https://thatopen.github.io/engine_components/resources/frags/school_arq.frag'

type RenderMode = 'fragments' | 'recreated' | 'declarativeRecreated'

export function ThatOpenFragment() {
  const { mode } = useControls('ThatOpen', {
    mode: {
      value: 'fragments' as RenderMode,
      options: {
        fragments: 'fragments',
        recreated: 'recreated',
        declarativeRecreated: 'declarativeRecreated',
      },
    },
  })

  const { models, stateRef, selectionOverlay } = useThatOpenFragments(
    FRAGMENT_URL,
    mode === 'fragments',
    mode === 'fragments'
  )

  return (
    <>
      {mode === 'fragments' && <FragmentsRenderer models={models} />}
      {mode === 'fragments' && selectionOverlay}

      {mode === 'recreated' && <RecreatedElementsRenderer fragments={stateRef.current?.fragments ?? null} />}
      {mode === 'declarativeRecreated' && (
        <DeclarativeRecreatedElementsRenderer fragments={stateRef.current?.fragments ?? null} />
      )}
    </>
  )
}
