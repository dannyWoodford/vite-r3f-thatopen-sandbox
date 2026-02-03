import * as OBC from '@thatopen/components'
import { Outlines } from '@react-three/drei'
import { useControls } from 'leva'
import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  MeshLambertMaterial,
} from 'three'
import { toMatrix4 } from './toMatrix4'

type Part = {
  key: string
  modelId: string
  localId: number
  geometry: BufferGeometry
  material: MeshLambertMaterial
  matrix: Matrix4
}

export function DeclarativeRecreatedElementsRenderer({
  fragments,
}: {
  fragments: OBC.FragmentsManager | null
}) {
  const { batchSize } = useControls('ThatOpen', {
    batchSize: { value: 200, min: 50, max: 2000, step: 50 },
  })

  const [parts, setParts] = useState<Part[]>([])
  const [selected, setSelected] = useState<{ modelId: string; localId: number } | null>(null)

  const disposablesRef = useRef<{
    geometries: BufferGeometry[]
    materials: MeshLambertMaterial[]
  } | null>(null)

  useEffect(() => {
    if (!fragments) return
    if (fragments.list.size === 0) return

    let cancelled = false
    setSelected(null)
    setParts([])

    const geometries: BufferGeometry[] = []
    const materialsToDispose: MeshLambertMaterial[] = []

    const materialCache = new Map<number, MeshLambertMaterial>()
    const fallbackMaterial = new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide })
    materialsToDispose.push(fallbackMaterial)

    const normalize01 = (v: any) => {
      if (typeof v !== 'number' || Number.isNaN(v)) return 1
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
      const nextParts: Part[] = []

      for (const [modelId, model] of fragments.list) {
        if (cancelled) return

        const allSamples = await model.getSamples()
        if (cancelled) return
        const allRawMaterials = await model.getMaterials()
        if (cancelled) return

        const allIds = await model.getItemsIdsWithGeometry()
        if (cancelled) return

        // eslint-disable-next-line no-console
        console.log(`[declarative-recreate] ${modelId}: rebuilding ${allIds.length} elements`)

        for (let start = 0; start < allIds.length; start += batchSize) {
          if (cancelled) return
          const chunk = allIds.slice(start, start + batchSize)

          const meshesById = await model.getItemsGeometry(chunk, 0 as any)
          if (cancelled) return

          // Collect sampleIds used by this batch.
          const sampleIdSet = new Set<number>()
          for (const partsArr of meshesById ?? []) {
            for (const md of partsArr as any[]) {
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
            materialIdSet.size > 0 ? await model.getMaterials(Array.from(materialIdSet)) : new Map()
          if (cancelled) return

          for (let i = 0; i < chunk.length; i++) {
            const localId = chunk[i]
            const elemParts = meshesById?.[i] ?? []
            if (!elemParts.length) continue

            let partIndex = 0
            for (const md of elemParts as any[]) {
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

              const matrix = toMatrix4(md.transform)
              nextParts.push({
                key: `part:${modelId}:${localId}:${partIndex++}`,
                modelId,
                localId,
                geometry,
                material: mat,
                matrix,
              })
            }
          }
        }
      }

      disposablesRef.current = { geometries, materials: materialsToDispose }
      setParts(nextParts)

      // eslint-disable-next-line no-console
      console.log('[declarative-recreate] done', { parts: nextParts.length })
    }

    run().catch(console.error)

    return () => {
      cancelled = true

      const d = disposablesRef.current
      if (d) {
        for (const g of d.geometries) g.dispose()
        for (const m of d.materials) m.dispose()
      }
      disposablesRef.current = null
      setParts([])
      setSelected(null)
    }
  }, [batchSize, fragments])

  if (parts.length === 0) return null

  return (
    <group name='declarative-recreated-root'>
      {parts.map((part) => {
        const isSelected =
          !!selected && selected.modelId === part.modelId && selected.localId === part.localId

        return (
          <mesh
            key={part.key}
            geometry={part.geometry}
            material={part.material}
            matrix={part.matrix}
            matrixAutoUpdate={false}
            name={part.key}
            onPointerDown={(e) => {
              e.stopPropagation()
              setSelected({ modelId: part.modelId, localId: part.localId })
            }}
          >
            {isSelected && <Outlines thickness={0.02} color='white' screenspace angle={0} />}
          </mesh>
        )
      })}
    </group>
  )
}

