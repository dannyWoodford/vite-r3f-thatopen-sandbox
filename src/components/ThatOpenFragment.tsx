import { useFrame, useThree } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import * as OBC from '@thatopen/components'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Object3D } from 'three'
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector2,
} from 'three'

const WORKER_URL = 'https://thatopen.github.io/engine_fragment/resources/worker.mjs'
const FRAGMENT_URL =
  'https://thatopen.github.io/engine_components/resources/frags/school_arq.frag'

type ThatOpenState = {
  components: OBC.Components
  fragments: OBC.FragmentsManager
  hiddenContainer: HTMLDivElement
  workerUrl: string
}

type ModelEntry = { modelId: string; object: Object3D }
type Selection = { modelId: string; localId: number; itemId: number | null } | null
type SelectionPart = { geometry: BufferGeometry; matrix: Matrix4 }

function useThatOpenFragments(fragmentUrl: string) {
  const { camera } = useThree()
  const stateRef = useRef<ThatOpenState | null>(null)
  const mountedRef = useRef(true)
  const [models, setModels] = useState<ModelEntry[]>([])

  const updateModelsFromList = useMemo(() => {
    return () => {
      const state = stateRef.current
      if (!state) return
      const next: ModelEntry[] = []
      for (const [modelId, model] of state.fragments.list) {
        next.push({ modelId, object: model.object })
      }
      setModels(next)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    const run = async () => {
      const hiddenContainer = document.createElement('div')
      hiddenContainer.style.cssText =
        'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none'
      document.body.appendChild(hiddenContainer)

      const components = new OBC.Components()
      const worlds = components.get(OBC.Worlds)
      const world = worlds.create<
        OBC.SimpleScene,
        OBC.OrthoPerspectiveCamera,
        OBC.SimpleRenderer
      >()

      world.scene = new OBC.SimpleScene(components)
      world.scene.setup()
      world.renderer = new OBC.SimpleRenderer(components, hiddenContainer)
      world.camera = new OBC.OrthoPerspectiveCamera(components)
      await world.camera.controls.setLookAt(68, 23, -8.5, 21.5, -5.5, 23)

      components.init()

      const workerRes = await fetch(WORKER_URL)
      const workerBlob = await workerRes.blob()
      const workerFile = new File([workerBlob], 'worker.mjs', {
        type: 'text/javascript',
      })
      const workerUrl = URL.createObjectURL(workerFile)
      const fragments = components.get(OBC.FragmentsManager)
      fragments.init(workerUrl)

      fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
        if (!('isLodMaterial' in material && material.isLodMaterial)) {
          material.polygonOffset = true
          material.polygonOffsetUnits = 1
          material.polygonOffsetFactor = Math.random()
        }
      })

      fragments.list.onItemSet.add(() => {
        if (!mountedRef.current) return
        updateModelsFromList()
        fragments.core.update(true)
      })

      stateRef.current = { components, fragments, hiddenContainer, workerUrl }

      const modelId = fragmentUrl.split('/').pop()?.split('.').shift() ?? 'model'
      const fileRes = await fetch(fragmentUrl)
      const buffer = await fileRes.arrayBuffer()
      await fragments.core.load(buffer, { modelId })
      updateModelsFromList()
    }

    run().catch(console.error)

    return () => {
      mountedRef.current = false
      const state = stateRef.current
      if (!state) return
      const { hiddenContainer, workerUrl } = state
      state.fragments.dispose()
      URL.revokeObjectURL(workerUrl)
      hiddenContainer.remove()
      stateRef.current = null
      setModels([])
    }
  }, [fragmentUrl, updateModelsFromList])

  useFrame(() => {
    const state = stateRef.current
    if (!state?.fragments) return
    const { fragments } = state
    for (const [, model] of fragments.list) {
      model.useCamera(camera)
    }
    fragments.core.update()
  })

  return { models, stateRef }
}

export function ThatOpenFragment() {
  const { gl, camera } = useThree()
  const { models, stateRef } = useThatOpenFragments(FRAGMENT_URL)
  const raycastInFlightRef = useRef(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [selectionParts, setSelectionParts] = useState<SelectionPart[]>([])

  useEffect(() => {
    const el = gl.domElement
    const pointer = new Vector2()

    const onPointerDown = (ev: PointerEvent) => {
      if (models.length === 0) return
      if (raycastInFlightRef.current) return

      // That Open provides its own raycast that works with Fragments LOD/tiles,
      // and avoids three.js attribute issues (e.g. GLBufferAttribute).
      const state = stateRef.current
      if (!state) return
      const fragments = state.fragments

      const doRaycast = async () => {
        raycastInFlightRef.current = true
        try {
          pointer.x = ev.clientX
          pointer.y = ev.clientY

          const tasks: Array<Promise<{ modelId: string; result: any }>> = []
          for (const [modelId, model] of fragments.list) {
            tasks.push(
              model
                .raycast({ camera, mouse: pointer, dom: el })
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
              itemId: typeof closest.result?.itemId === 'number' ? closest.result.itemId : null,
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
            // Many Fragments raycast results include item IDs / fragment maps.
            result: closest.result,
          })
        } finally {
          raycastInFlightRef.current = false
        }
      }

      void doRaycast()
    }

    el.addEventListener('pointerdown', onPointerDown)
    return () => el.removeEventListener('pointerdown', onPointerDown)
  }, [gl, camera, models])

  useEffect(() => {
    const sel = selection
    const state = stateRef.current
    if (!sel || !state) return

    let cancelled = false
    const toDispose: BufferGeometry[] = []

    const toMatrix4 = (t: unknown) => {
      if (!t) return new Matrix4()
      if (t instanceof Matrix4) return t.clone()
      const anyT = t as any
      if (Array.isArray(anyT) && anyT.length >= 16) return new Matrix4().fromArray(anyT)
      if (ArrayBuffer.isView(anyT)) {
        const arr = anyT as unknown as ArrayLike<number>
        if (arr.length >= 16) return new Matrix4().fromArray(Array.from(arr))
      }
      if (anyT.elements && Array.isArray(anyT.elements) && anyT.elements.length >= 16) {
        return new Matrix4().fromArray(anyT.elements)
      }
      return new Matrix4()
    }

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
      {models.map(({ modelId, object }) => (
        <primitive
          // eslint-disable-next-line react/no-unknown-property
          key={modelId}
          object={object}
        />
      ))}

      {/* Outline overlay for the currently selected element */}
      {selectionParts.map((part, i) => (
        <mesh
          key={`${selection?.modelId ?? 'model'}:${selection?.localId ?? 'none'}:${i}`}
          geometry={part.geometry}
          matrix={part.matrix}
          matrixAutoUpdate={false}
          renderOrder={999}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={true} />
          <Outlines thickness={2} color='white'  />
        </mesh>
      ))}
    </>
  )
}
