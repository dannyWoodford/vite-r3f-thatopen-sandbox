import { useFrame, useThree } from '@react-three/fiber'
import * as OBC from '@thatopen/components'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Object3D } from 'three'

const WORKER_URL = 'https://thatopen.github.io/engine_fragment/resources/worker.mjs'

export type ModelEntry = { modelId: string; object: Object3D }

type ThatOpenState = {
  fragments: OBC.FragmentsManager
  workerUrl: string
}

export function useThatOpenFragments(fragmentUrl: string, enableUpdates: boolean) {
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
        // console.log('material', material)
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
      if (!state) return
      const { workerUrl } = state
      state.fragments.dispose()
      URL.revokeObjectURL(workerUrl)
      stateRef.current = null
      setModels([])
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

  return { models, stateRef }
}

