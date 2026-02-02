import * as OBC from '@thatopen/components'
import { useControls } from 'leva'
import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Color,
  DoubleSide,
  MeshLambertMaterial,
  Mesh as ThreeMesh,
} from 'three'
import { toMatrix4 } from './toMatrix4'

export function RecreatedElementsRenderer({
  fragments,
}: {
  fragments: OBC.FragmentsManager | null
}) {
  const { batchSize } = useControls('ThatOpen', {
    batchSize: { value: 200, min: 50, max: 2000, step: 50 },
  })

  const [root, setRoot] = useState<Group | null>(null)
  // Dispose geometries + created materials.
  const disposablesRef = useRef<{
    geometries: BufferGeometry[]
    materials: MeshLambertMaterial[]
  } | null>(null)

  useEffect(() => {
    if (!fragments) return
    if (fragments.list.size === 0) return

    let cancelled = false
    const nextRoot = new Group()
    nextRoot.name = 'recreated-elements-root'
    setRoot(nextRoot)

    const geometries: BufferGeometry[] = []
    const materialsToDispose: MeshLambertMaterial[] = []
    const materialCache = new Map<number, MeshLambertMaterial>()
    const fallbackMaterial = new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide })
    materialsToDispose.push(fallbackMaterial)

    const normalize01 = (v: any) => {
      if (typeof v !== 'number' || Number.isNaN(v)) return 1
      // RawMaterial sometimes comes in 0..255 (not 0..1). THREE.Color expects 0..1.
      if (v > 1) return v / 255
      return v
    }

    const getOrCreateMaterial = (materialId: number, raw: any) => {
      const cached = materialCache.get(materialId)
      if (cached) return cached
      const mat = new MeshLambertMaterial({
        color: new Color(normalize01(raw?.r), normalize01(raw?.g), normalize01(raw?.b)),
        transparent: typeof raw?.a === 'number' ? normalize01(raw.a) < 1 : false,
        opacity: typeof raw?.a === 'number' ? normalize01(raw.a) : 1,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetUnits: 1,
        polygonOffsetFactor: Math.random(),
      })
      materialCache.set(materialId, mat)
      materialsToDispose.push(mat)
      return mat
    }

    const run = async () => {
      for (const [modelId, model] of fragments.list) {
        if (cancelled) return

        // Pull all sample/material data once (more reliable than partial queries in some models).
        const allSamples = await model.getSamples()
        if (cancelled) return
        const allRawMaterials = await model.getMaterials()
        if (cancelled) return
        let loggedOnce = false

        const allIds = await model.getItemsIdsWithGeometry()
        if (cancelled) return

        // eslint-disable-next-line no-console
        console.log(`[recreate] ${modelId}: rebuilding ${allIds.length} elements`)

        for (let start = 0; start < allIds.length; start += batchSize) {
          if (cancelled) return
          const chunk = allIds.slice(start, start + batchSize)
          const meshesById = await model.getItemsGeometry(chunk, 0 as any)
          if (cancelled) return

          // Collect sampleIds used by this batch.
          const sampleIdSet = new Set<number>()
          for (const parts of meshesById ?? []) {
            for (const md of parts as any[]) {
              if (typeof md?.sampleId === 'number') sampleIdSet.add(md.sampleId)
            }
          }

          const samples =
            sampleIdSet.size > 0 ? await model.getSamples(Array.from(sampleIdSet)) : new Map()
          if (cancelled) return

          const materialIdSet = new Set<number>()
          for (const [, sample] of samples as any) {
            const matId = (sample as any)?.material
            if (typeof matId === 'number') materialIdSet.add(matId)
          }

          const rawMaterials =
            materialIdSet.size > 0
              ? await model.getMaterials(Array.from(materialIdSet))
              : new Map()
          if (cancelled) return

          for (let i = 0; i < chunk.length; i++) {
            const localId = chunk[i]
            const parts = meshesById?.[i] ?? []
            if (!parts.length) continue

            const elementGroup = new Group()
            elementGroup.name = `element:${modelId}:${localId}`
            ;(elementGroup as any).userData = { modelId, localId }

            for (const md of parts as any[]) {
              if (!md.positions || md.positions.length === 0) continue

              const geometry = new BufferGeometry()
              geometries.push(geometry)

              const positions =
                md.positions instanceof Float64Array ? new Float32Array(md.positions) : md.positions
              geometry.setAttribute('position', new Float32BufferAttribute(positions as any, 3))

              if (md.indices && md.indices.length > 0) {
                geometry.setIndex(new BufferAttribute(md.indices as any, 1))
              }

              geometry.computeBoundingSphere()
              geometry.computeVertexNormals()

              let mat = fallbackMaterial
              const sampleId = md.sampleId
              if (typeof sampleId === 'number') {
                const sample = (allSamples as any).get(sampleId) ?? (samples as any).get(sampleId)
                const matId = sample?.material
                if (typeof matId === 'number') {
                  const raw = (allRawMaterials as any).get(matId) ?? (rawMaterials as any).get(matId)
                  mat = getOrCreateMaterial(matId, raw)
                }
              }

              if (!loggedOnce) {
                loggedOnce = true
                // eslint-disable-next-line no-console
                console.log('[recreate:material-debug]', {
                  modelId,
                  example: {
                    sampleId: md.sampleId ?? null,
                    sampleFoundInAll: typeof md.sampleId === 'number' ? (allSamples as any).has(md.sampleId) : null,
                    sampleFoundInChunk: typeof md.sampleId === 'number' ? (samples as any).has(md.sampleId) : null,
                    sampleMaterialId:
                      typeof md.sampleId === 'number'
                        ? ((allSamples as any).get(md.sampleId)?.material ??
                          (samples as any).get(md.sampleId)?.material ??
                          null)
                        : null,
                  },
                  allSamplesCount: (allSamples as any).size ?? null,
                  chunkSamplesCount: (samples as any).size ?? null,
                  allMaterialsCount: (allRawMaterials as any).size ?? null,
                  chunkMaterialsCount: (rawMaterials as any).size ?? null,
                })
              }

              const mesh = new ThreeMesh(geometry, mat)
              mesh.matrixAutoUpdate = false
              mesh.matrix.copy(toMatrix4(md.transform))
              mesh.name = `part:${modelId}:${localId}`
              elementGroup.add(mesh)
            }

            nextRoot.add(elementGroup)
          }
        }
      }

      disposablesRef.current = { geometries, materials: materialsToDispose }
      // eslint-disable-next-line no-console
      console.log('[recreate] done')
    }

    run().catch(console.error)

    return () => {
      cancelled = true
      // Clean up if the component unmounts mid-run.
      const d = disposablesRef.current
      if (d) {
        for (const g of d.geometries) g.dispose()
        for (const m of d.materials) m.dispose()
      }
      disposablesRef.current = null
      setRoot(null)
    }
  }, [batchSize, fragments])

  if (!root) return null

  return (
    <primitive
      // eslint-disable-next-line react/no-unknown-property
      object={root}
    />
  )
}

