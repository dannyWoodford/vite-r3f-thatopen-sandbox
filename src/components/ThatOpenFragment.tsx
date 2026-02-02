import { useFrame, useThree } from '@react-three/fiber'
import * as OBC from '@thatopen/components'
import { useEffect, useRef } from 'react'

const WORKER_URL = 'https://thatopen.github.io/engine_fragment/resources/worker.mjs'
const FRAGMENT_URL =
  'https://thatopen.github.io/engine_components/resources/frags/school_arq.frag'

type ThatOpenState = {
  components: OBC.Components
  fragments: OBC.FragmentsManager
  hiddenContainer: HTMLDivElement
  workerUrl: string
}

export function ThatOpenFragment() {
  const { scene, camera } = useThree()
  const stateRef = useRef<ThatOpenState | null>(null)
  const mountedRef = useRef(true)

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

      fragments.list.onItemSet.add(({ value: model }) => {
        if (!mountedRef.current) return
        model.useCamera(camera)
        scene.add(model.object)
        fragments.core.update(true)
      })

      stateRef.current = { components, fragments, hiddenContainer, workerUrl }

      const modelId = FRAGMENT_URL.split('/').pop()?.split('.').shift() ?? 'model'
      const fileRes = await fetch(FRAGMENT_URL)
      const buffer = await fileRes.arrayBuffer()
      await fragments.core.load(buffer, { modelId })
    }

    run().catch(console.error)

    return () => {
      mountedRef.current = false
      const state = stateRef.current
      if (!state) return
      const { fragments, hiddenContainer, workerUrl } = state
      for (const [, model] of fragments.list) {
        scene.remove(model.object)
      }
      fragments.dispose()
      URL.revokeObjectURL(workerUrl)
      hiddenContainer.remove()
      stateRef.current = null
    }
  }, [scene, camera])

  useFrame(() => {
    const state = stateRef.current
    if (!state?.fragments) return
    const { fragments } = state
    for (const [, model] of fragments.list) {
      model.useCamera(camera)
    }
    fragments.core.update()
  })

  return null
}
