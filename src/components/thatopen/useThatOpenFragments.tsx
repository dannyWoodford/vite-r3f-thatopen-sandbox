import { Outlines } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as OBC from '@thatopen/components'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Object3D } from 'three'
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector2,
  Vector3,
} from 'three'
import { toMatrix4 } from './utils/toMatrix4'

const WORKER_URL = 'https://thatopen.github.io/engine_fragment/resources/worker.mjs'

export type ModelEntry = { modelId: string; object: Object3D }

type ThatOpenState = {
  fragments: OBC.FragmentsManager
  workerUrl: string
}

type SelectionPart = { geometry: BufferGeometry; matrix: Matrix4 }

export function useThatOpenFragments(
  fragmentUrl: string,
  enableUpdates: boolean,
  enableSelectionOverlay: boolean
) {
  const { gl, camera } = useThree()
  const stateRef = useRef<ThatOpenState | null>(null)
  const mountedRef = useRef(true)
  const [models, setModels] = useState<ModelEntry[]>([])

  const raycastInFlightRef = useRef(false)
  const [selectionParts, setSelectionParts] = useState<SelectionPart[]>([])

  const clickCatcherRef = useRef<any>(null)
  const clickCatcherGeometry = useMemo(() => new BufferGeometry(), [])
  const tmpPoint = useMemo(() => new Vector3(), [])

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
      const components = new OBC.Components()

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

      stateRef.current = { fragments, workerUrl }

      const modelId = fragmentUrl.split('/').pop()?.split('.').shift() ?? 'model'
      const fileRes = await fetch(fragmentUrl)
      const buffer = await fileRes.arrayBuffer()
      await fragments.core.load(buffer, { modelId })
    }

    run().catch(console.error)

    return () => {
      mountedRef.current = false
      const state = stateRef.current
      if (state) {
        state.fragments.dispose()
        URL.revokeObjectURL(state.workerUrl)
      }
      stateRef.current = null

      setModels([])
      setSelectionParts((prev) => {
        for (const p of prev) p.geometry.dispose()
        return []
      })
    }
  }, [fragmentUrl, updateModelsFromList])

  useFrame(() => {
    if (!enableUpdates) return
    const state = stateRef.current
    if (!state?.fragments) return
    const { fragments } = state
    for (const [, model] of fragments.list) model.useCamera(camera)
    fragments.core.update()
  })

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!enableSelectionOverlay) return
    if (raycastInFlightRef.current) return
    const state = stateRef.current
    if (!state) return
    const fragments = state.fragments
    if (fragments.list.size === 0) return

    const pointerPx = new Vector2(e.nativeEvent.clientX, e.nativeEvent.clientY)

    const doRaycast = async () => {
      raycastInFlightRef.current = true
      try {
        const tasks: Array<Promise<{ modelId: string; result: any }>> = []
        for (const [modelId, model] of fragments.list) {
          tasks.push(
            model
              .raycast({ camera, mouse: pointerPx, dom: gl.domElement })
              .then((result: any) => ({ modelId, result }))
          )
        }

        const results = await Promise.all(tasks)
        const hits = results.filter((r) => r.result)
        if (hits.length === 0) {
          setSelectionParts((prev) => {
            for (const p of prev) p.geometry.dispose()
            return []
          })
          return
        }

        let closest = hits[0]
        for (let i = 1; i < hits.length; i++) {
          if (hits[i].result.distance < closest.result.distance) closest = hits[i]
        }

        const localId = closest.result?.localId
        if (typeof localId !== 'number') return

        const model = fragments.list.get(closest.modelId)
        if (!model) return

        const data = await model.getItemsGeometry([localId], 0 as any)
        const meshDatas = data?.[0] ?? []
        const nextParts: SelectionPart[] = []

        for (const md of meshDatas as any[]) {
          if (!md.positions || md.positions.length === 0) continue

          const geometry = new BufferGeometry()
          const positions =
            md.positions instanceof Float64Array ? new Float32Array(md.positions) : md.positions
          geometry.setAttribute('position', new Float32BufferAttribute(positions as any, 3))
          if (md.indices && md.indices.length > 0) {
            geometry.setIndex(new BufferAttribute(md.indices as any, 1))
          }
          geometry.computeBoundingSphere()

          nextParts.push({
            geometry,
            matrix: toMatrix4(md.transform),
          })
        }

        setSelectionParts((prev) => {
          for (const p of prev) p.geometry.dispose()
          return nextParts
        })
      } finally {
        raycastInFlightRef.current = false
      }
    }

    void doRaycast()
  }

  const selectionOverlay = enableSelectionOverlay ? (
    <>
      <mesh
        // eslint-disable-next-line react/no-unknown-property
        ref={clickCatcherRef}
        geometry={clickCatcherGeometry}
        frustumCulled={false}
        // eslint-disable-next-line react/no-unknown-property
        raycast={(raycaster, intersects) => {
          const obj = clickCatcherRef.current as any
          if (!obj) return
          tmpPoint.copy(raycaster.ray.direction).multiplyScalar(1).add(raycaster.ray.origin)
          intersects.push({ distance: 0, point: tmpPoint.clone(), object: obj })
        }}
        onPointerDown={handlePointerDown}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>

      {selectionParts.map((part, i) => (
        <mesh
          key={`fragsel:${i}`}
          geometry={part.geometry}
          matrix={part.matrix}
          matrixAutoUpdate={false}
          renderOrder={999}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite />
          <Outlines thickness={0.02} color='white' screenspace angle={0} />
        </mesh>
      ))}
    </>
  ) : null

  useEffect(() => {
    if (enableSelectionOverlay) return
    setSelectionParts((prev) => {
      for (const p of prev) p.geometry.dispose()
      return []
    })
  }, [enableSelectionOverlay])

  return { models, stateRef, selectionOverlay }
}

