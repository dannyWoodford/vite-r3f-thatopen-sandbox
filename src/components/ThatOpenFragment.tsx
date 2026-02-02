import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import { useControls } from 'leva'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Mesh } from 'three'
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three'
import { FragmentsRenderer } from './thatopen/FragmentsRenderer'
import { RecreatedElementsRenderer } from './thatopen/RecreatedElementsRenderer'
import { toMatrix4 } from './thatopen/toMatrix4'
import { useThatOpenFragments } from './thatopen/useThatOpenFragments'

const FRAGMENT_URL =
  'https://thatopen.github.io/engine_components/resources/frags/school_arq.frag'

type RenderMode = 'fragments' | 'recreated'
type Selection = { modelId: string; localId: number } | null
type SelectionPart = { geometry: BufferGeometry; matrix: ReturnType<typeof toMatrix4> }

export function ThatOpenFragment() {
  const { mode } = useControls('ThatOpen', {
    mode: {
      value: 'fragments' as RenderMode,
      options: {
        fragments: 'fragments',
        recreated: 'recreated',
      },
    },
  })

  const { gl, camera } = useThree()
  const { models, stateRef } = useThatOpenFragments(FRAGMENT_URL, mode === 'fragments')
  const raycastInFlightRef = useRef(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [selectionParts, setSelectionParts] = useState<SelectionPart[]>([])
  const clickCatcherRef = useRef<Mesh | null>(null)
  const clickCatcherGeometry = useMemo(() => new BufferGeometry(), [])
  const tmpPoint = useMemo(() => new Vector3(), [])

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (raycastInFlightRef.current) return
    const state = stateRef.current
    if (!state) return
    const fragments = state.fragments
    if (fragments.list.size === 0) return

    const ev = e.nativeEvent
    const pointer = new Vector2(ev.clientX, ev.clientY)

    const doRaycast = async () => {
      raycastInFlightRef.current = true
      try {
        const tasks: Array<Promise<{ modelId: string; result: any }>> = []
        for (const [modelId, model] of fragments.list) {
          tasks.push(
            model
              .raycast({ camera, mouse: pointer, dom: gl.domElement })
              .then((result: any) => ({ modelId, result }))
          )
        }

        const results = await Promise.all(tasks)
        const hits = results.filter((r) => r.result)
        if (hits.length === 0) return

        let closest = hits[0]
        for (let i = 1; i < hits.length; i++) {
          if (hits[i].result.distance < closest.result.distance) closest = hits[i]
        }

        const localId = closest.result?.localId
        if (typeof localId === 'number') {
          setSelection({
            modelId: closest.modelId,
            localId,
          })
        } else {
          setSelection(null)
        }

        // eslint-disable-next-line no-console
        console.log('Fragment raycast hit', {
          modelId: closest.modelId,
          hitKey: `${closest.modelId}:${closest.result?.itemId ?? closest.result?.localId ?? 'unknown'}`,
          objectName: closest.result?.object?.name ?? null,
          objectUuid: closest.result?.object?.uuid ?? null,
          itemId: closest.result?.itemId ?? null,
          localId: closest.result?.localId ?? null,
          representationClass: closest.result?.representationClass ?? null,
          distance: closest.result.distance,
          point: closest.result.point,
          normal: closest.result.normal,
        })
      } finally {
        raycastInFlightRef.current = false
      }
    }

    void doRaycast()
  }

  useEffect(() => {
    const sel = selection
    const state = stateRef.current
    if (!sel || !state) return

    let cancelled = false
    const toDispose: BufferGeometry[] = []

    const run = async () => {
      const model = state.fragments.list.get(sel.modelId)
      if (!model) return

      // LOD GEOMETRY = 0 (const enum CurrentLod.GEOMETRY)
      const data = await model.getItemsGeometry([sel.localId], 0 as any)
      if (cancelled) return

      const meshDatas = data?.[0] ?? []
      const nextParts: SelectionPart[] = []

      for (const md of meshDatas) {
        if (!md.positions || md.positions.length === 0) continue

        const geometry = new BufferGeometry()
        toDispose.push(geometry)

        const positions =
          md.positions instanceof Float64Array ? new Float32Array(md.positions) : md.positions
        geometry.setAttribute('position', new Float32BufferAttribute(positions as any, 3))

        if (md.indices && md.indices.length > 0) {
          geometry.setIndex(new BufferAttribute(md.indices as any, 1))
        }

        geometry.computeBoundingSphere()

        nextParts.push({
          geometry,
          matrix: toMatrix4((md as any).transform),
        })
      }

      setSelectionParts(nextParts)
    }

    run().catch(console.error)

    return () => {
      cancelled = true
      for (const g of toDispose) g.dispose()
    }
  }, [selection, stateRef])

  return (
    <>
      {/* R3F-native click catcher: always receives pointer events */}
      <mesh
        // eslint-disable-next-line react/no-unknown-property
        ref={clickCatcherRef}
        geometry={clickCatcherGeometry}
        frustumCulled={false}
        // eslint-disable-next-line react/no-unknown-property
        raycast={(raycaster, intersects) => {
          const obj = clickCatcherRef.current as any
          if (!obj) return
          // Force an "always hit" intersection so onPointerDown fires anywhere in the canvas.
          tmpPoint
            .copy(raycaster.ray.direction)
            .multiplyScalar(1)
            .add(raycaster.ray.origin)
          intersects.push({ distance: 0, point: tmpPoint.clone(), object: obj })
        }}
        onPointerDown={handlePointerDown}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>

      {mode === 'fragments' && <FragmentsRenderer models={models} />}

      {mode === 'recreated' && (
        <RecreatedElementsRenderer
          fragments={stateRef.current?.fragments ?? null}
        />
      )}

      {/* Outline overlay for the currently selected element */}
      {selectionParts.map((part, i) => (
        <mesh
          key={`${selection?.modelId ?? 'model'}:${selection?.localId ?? 'none'}:${i}`}
          geometry={part.geometry}
          matrix={part.matrix}
          matrixAutoUpdate={false}
          renderOrder={999}
        >
          <meshBasicMaterial 
            transparent={true}
            opacity={0} 
            depthWrite={true}           
          />
          <Outlines thickness={0.02} color='white' screenspace={true} angle={0} />
        </mesh>
      ))}
    </>
  )
}
