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
import { getGeometryKeyFromMeshData, getMaterialKeyFromMeshData } from './utils/instancingKeys'
import { toMatrix4 } from './utils/toMatrix4'

type Disposables = {
  geometries: BufferGeometry[]
  materials: MeshLambertMaterial[]
}

type Part = {
  key: string
  modelId: string
  localId: number
  geometry: BufferGeometry
  material: MeshLambertMaterial
  matrix: Matrix4
}

// Fragments "RawMaterial" color channels can arrive as 0..255 or 0..1.
// THREE.Color expects 0..1, so normalize aggressively to avoid "all white" clamping.
function normalize01(v: unknown) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 1
  // RawMaterial sometimes comes in 0..255 (not 0..1). THREE.Color expects 0..1.
  if (v > 1) return v / 255
  return v
}

// Material resolver used during rebuild:
// - creates visible, simple Lambert materials from Fragments' RawMaterial
// - caches per materialId so thousands of parts can share a few materials
// - registers every created material in `disposables` for cleanup on rebuild/unmount
function createLambertMaterialResolver(disposables: Disposables) {
  const materialCache = new Map<number, MeshLambertMaterial>()
  // Fallback for parts that don't have sample/material info.
  const fallbackMaterial = new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide })
  disposables.materials.push(fallbackMaterial)

  const getOrCreate = (materialId: number, raw: any) => {
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
    disposables.materials.push(mat)
    return mat
  }

  const resolveForMeshData = (meshData: any, allSamples: any, allRawMaterials: any) => {
    const sampleId = meshData?.sampleId
    if (typeof sampleId !== 'number') return fallbackMaterial

    const sample = allSamples?.get(sampleId)
    const materialId = sample?.material
    if (typeof materialId !== 'number') return fallbackMaterial

    const rawMaterial = allRawMaterials?.get(materialId)
    return getOrCreate(materialId, rawMaterial)
  }

  return { fallbackMaterial, resolveForMeshData }
}

// Build CPU-side BufferGeometry for a single Fragments MeshData part.
// Returns null for empty parts. Every created geometry is registered in `disposables`.
function buildGeometryFromMeshData(meshData: any, disposables: Disposables): BufferGeometry | null {
  if (!meshData?.positions || meshData.positions.length === 0) return null

  const geometry = new BufferGeometry()
  disposables.geometries.push(geometry)

  const positions =
    meshData.positions instanceof Float64Array ? new Float32Array(meshData.positions) : meshData.positions
  geometry.setAttribute('position', new Float32BufferAttribute(positions as any, 3))

  if (meshData.indices && meshData.indices.length > 0) {
    geometry.setIndex(new BufferAttribute(meshData.indices as any, 1))
  }

  geometry.computeBoundingSphere()
  geometry.computeVertexNormals()
  return geometry
}

export function DeclarativeRecreatedElementsRenderer({
  fragments,
}: {
  fragments: OBC.FragmentsManager | null
}) {
  const { batchSize } = useControls('ThatOpen', {
    batchSize: { value: 200, min: 50, max: 2000, step: 50 },
  })

  // `build` owns *both*:
  // - the list of parts we render (React data)
  // - all GPU resources created for that list (geometries/materials), so we can dispose safely
  const [build, setBuild] = useState<{ parts: Part[]; disposables: Disposables } | null>(null)
  const [selected, setSelected] = useState<{ modelId: string; localId: number } | null>(null)

  // Track latest build for unmount cleanup without re-subscribing effects.
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    // On unmount, dispose any remaining GPU resources from the last build.
    return () => {
      const b = buildRef.current
      if (!b) return
      for (const g of b.disposables.geometries) g.dispose()
      for (const m of b.disposables.materials) m.dispose()
    }
  }, [])

  useEffect(() => {
    if (!fragments) return
    if (fragments.list.size === 0) return

    let cancelled = false
    setSelected(null)
    // Clear current build while a new rebuild is in progress (keeps this mode "all-or-nothing").
    setBuild(null)

    const run = async () => {
      const disposables: Disposables = { geometries: [], materials: [] }
      const materialResolver = createLambertMaterialResolver(disposables)
      const nextParts: Part[] = []

      // Instancing audit:
      // We don't instance yet; we just measure how many repeated (geometryKey + materialKey) buckets exist.
      const geometryCounts = new Map<string, number>()
      const bucketCounts = new Map<string, number>()

      // Rebuild declaratively: produce a flat list of <mesh> parts.
      // This intentionally differs from `RecreatedElementsRenderer` (imperative Group mutation)
      // to compare performance / ergonomics of "React-owned meshes".
      for (const [modelId, model] of fragments.list) {
        if (cancelled) return

        // Pull sample/material maps once per model. (We do NOT refetch per batch.)
        const allSamples = await model.getSamples()
        if (cancelled) return
        const allRawMaterials = await model.getMaterials()
        if (cancelled) return

        const allIds = await model.getItemsIdsWithGeometry()
        if (cancelled) return

        // eslint-disable-next-line no-console
        console.log(`[declarative-recreate] ${modelId}: rebuilding ${allIds.length} elements`)

        // `batchSize` bounds the amount of geometry we request per async call to Fragments.
        for (let start = 0; start < allIds.length; start += batchSize) {
          if (cancelled) return
          const chunk = allIds.slice(start, start + batchSize)

          const meshesById = await model.getItemsGeometry(chunk, 0 as any)
          if (cancelled) return

          for (let i = 0; i < chunk.length; i++) {
            const localId = chunk[i]
            const elemParts = meshesById?.[i] ?? []
            if (!elemParts.length) continue

            // Multiple parts can belong to the same element; we keep a stable-ish key per part.
            let partIndex = 0
            for (const md of elemParts as any[]) {
              const geometryKey = getGeometryKeyFromMeshData(md)
              geometryCounts.set(geometryKey, (geometryCounts.get(geometryKey) ?? 0) + 1)
              const materialKey = getMaterialKeyFromMeshData(md, allSamples)
              const bucketKey = `${materialKey}|${geometryKey}`
              bucketCounts.set(bucketKey, (bucketCounts.get(bucketKey) ?? 0) + 1)

              const geometry = buildGeometryFromMeshData(md, disposables)
              if (!geometry) continue
              const mat = materialResolver.resolveForMeshData(md, allSamples, allRawMaterials)
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

      if (cancelled) {
        // If the component re-renders/unmounts mid-build, clean up the work-in-progress resources.
        for (const g of disposables.geometries) g.dispose()
        for (const m of disposables.materials) m.dispose()
        return
      }

      // Swap builds.
      // We dispose the previous build *as we replace it* so we don't leak GPU resources across rebuilds.
      setBuild((prev) => {
        if (prev) {
          for (const g of prev.disposables.geometries) g.dispose()
          for (const m of prev.disposables.materials) m.dispose()
        }
        return { parts: nextParts, disposables }
      })

      // eslint-disable-next-line no-console
      console.log('[declarative-recreate] done', { parts: nextParts.length })

      // eslint-disable-next-line no-console
      console.log('[instancing-audit]', {
        parts: nextParts.length,
        uniqueGeometries: geometryCounts.size,
        uniqueBuckets_geometryPlusMaterial: bucketCounts.size,
        // How many parts are in a bucket that repeats (count > 1):
        repeatedBucketParts: Array.from(bucketCounts.values()).reduce((acc, c) => acc + (c > 1 ? c : 0), 0),
        topBuckets: Array.from(bucketCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15),
      })
    }

    run().catch(console.error)

    return () => {
      cancelled = true
      setSelected(null)
    }
  }, [batchSize, fragments])

  const parts = build?.parts ?? []
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
              // Declarative mode uses normal per-mesh events (no click-catcher).
              e.stopPropagation()
              console.log('part', part)
              setSelected({ modelId: part.modelId, localId: part.localId })
            }}
          >
            {/* Self-contained selection feedback */}
            {isSelected && <Outlines thickness={0.02} color='white' screenspace angle={0} />}
          </mesh>
        )
      })}
    </group>
  )
}

