import * as OBC from '@thatopen/components'
import { Outlines, Bvh } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { button, useControls } from 'leva'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
} from 'three'
import { getGeometryKeyFromMeshData, getMaterialKeyFromMeshData } from './instancingKeys'
import { toMatrix4 } from './toMatrix4'
import { logInstancingAuditSummary } from './utils/instancingAudit'

type Disposables = {
  geometries: BufferGeometry[]
  materials: MeshLambertMaterial[]
}

type BucketBuild = {
  bucketKey: string
  geometryKey: string
  materialKey: string
  templateMd: any
  material: MeshLambertMaterial
  matrices: Matrix4[]
}

type Bucket = {
  bucketKey: string
  geometry: BufferGeometry
  material: MeshLambertMaterial
  matrices: Matrix4[]
}

function normalize01(v: unknown) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 1
  if (v > 1) return v / 255
  return v
}

function createLambertMaterialResolver(disposables: Disposables) {
  const materialCache = new Map<number, MeshLambertMaterial>()
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
      // IMPORTANT:
      // Avoid per-material randomness here. On Windows (ANGLE/D3D11) this can generate a huge number
      // of unique RasterizerState objects (one per distinct polygon offset), eventually failing with
      // "Error allocating RasterizerState" and causing rendering/material glitches after refresh.
      polygonOffsetFactor: 1,
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

  return { resolveForMeshData }
}

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

type Pick = { geometry: BufferGeometry; matrixWorld: Matrix4 }

function InstancedBucket({ bucket, onPick }: { bucket: Bucket; onPick: (pick: Pick) => void }) {
  const ref = useRef<InstancedMesh | null>(null)
  const tmpInstanceMatrix = useMemo(() => new Matrix4(), [])
  const tmpWorldMatrix = useMemo(() => new Matrix4(), [])

  // Keep constructor args stable; changing args causes R3F to recreate the underlying Three object.
  const args = useMemo(
    () => [bucket.geometry, bucket.material, bucket.matrices.length] as const,
    [bucket.geometry, bucket.material, bucket.matrices.length]
  )

  // Populate instance matrices once per bucket build.
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const count = bucket.matrices.length
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, bucket.matrices[i])
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [bucket])

  return (
    <instancedMesh
      // eslint-disable-next-line react/no-unknown-property
      ref={ref}
      args={args}
      frustumCulled={false}
      name={`instanced:${bucket.bucketKey}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        const mesh = ref.current
        const instanceId = (e as any)?.instanceId
        if (!mesh || typeof instanceId !== 'number') return
        mesh.getMatrixAt(instanceId, tmpInstanceMatrix)
        tmpWorldMatrix.multiplyMatrices(mesh.matrixWorld, tmpInstanceMatrix)
        onPick({ geometry: mesh.geometry as BufferGeometry, matrixWorld: tmpWorldMatrix.clone() })
      }}
    />
  )
}

function UninstancedBucketMeshes({
  bucket,
  materialMode,
  onPick,
}: {
  bucket: Bucket
  materialMode: 'original' | 'red'
  onPick: (pick: Pick) => void
}) {
  const redMaterial = useMemo(
    () =>
      new MeshLambertMaterial({
        color: 0xff0000,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetUnits: 1,
        polygonOffsetFactor: 0,
      }),
    []
  )

  useEffect(() => {
    return () => {
      redMaterial.dispose()
    }
  }, [redMaterial])

  return (
    <>
      {bucket.matrices.map((matrix, i) => (
        <mesh
          key={`${bucket.bucketKey}:${i}`}
          geometry={bucket.geometry}
          material={materialMode === 'red' ? redMaterial : bucket.material}
          matrix={matrix}
          matrixAutoUpdate={false}
          frustumCulled={false}
          name={`mesh:${bucket.bucketKey}:${i}`}
          onPointerDown={(e) => {
            e.stopPropagation()
            const obj: any = e.object
            if (!obj?.geometry) return
            obj.updateWorldMatrix?.(true, false)
            onPick({ geometry: obj.geometry as BufferGeometry, matrixWorld: obj.matrixWorld.clone() })
          }}
        />
      ))}
    </>
  )
}

export function InstancedRecreatedElementsRenderer({
  fragments,
  minSimilarInstances = 1,
}: {
  fragments: OBC.FragmentsManager | null
  // Only instance when a bucket has more than this many similar parts.
  // Example: if 5, only buckets with 6+ instances will be instanced.
  minSimilarInstances?: number
}) {
  const [rebuildToken, setRebuildToken] = useState(0)

  const { uninstancedMaterial, threshold } = useControls('ThatOpen', {
    threshold: {
      value: minSimilarInstances,
      min: 1,
      max: 50,
      step: 1,
    },
    uninstancedMaterial: {
      value: 'original' as 'original' | 'red',
      options: { original: 'original', red: 'red' },
    },
    regenerate: button(() => setRebuildToken((t) => t + 1)),
  })

  const batchSize = 200
  const [build, setBuild] = useState<{ buckets: Bucket[]; disposables: Disposables } | null>(null)
  const [selected, setSelected] = useState<Pick | null>(null)

  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    // Unmount cleanup.
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
    setBuild(null)

    const run = async () => {
      const disposables: Disposables = { geometries: [], materials: [] }
      const materialResolver = createLambertMaterialResolver(disposables)

      // bucketKey -> bucket build info
      const bucketMap = new Map<string, BucketBuild>()

      for (const [modelId, model] of fragments.list) {
        if (cancelled) return

        const allSamples = await model.getSamples()
        if (cancelled) return
        const allRawMaterials = await model.getMaterials()
        if (cancelled) return

        const allIds = await model.getItemsIdsWithGeometry()
        if (cancelled) return

        // eslint-disable-next-line no-console
        console.log(`[instanced-recreate] ${modelId}: scanning ${allIds.length} elements`)

        for (let start = 0; start < allIds.length; start += batchSize) {
          if (cancelled) return
          const chunk = allIds.slice(start, start + batchSize)

          const meshesById = await model.getItemsGeometry(chunk, 0 as any)
          if (cancelled) return

          for (let i = 0; i < chunk.length; i++) {
            const elemParts = meshesById?.[i] ?? []
            if (!elemParts.length) continue

            for (const md of elemParts as any[]) {
              if (!md?.positions || md.positions.length === 0) continue

              const geometryKey = getGeometryKeyFromMeshData(md)
              const materialKey = getMaterialKeyFromMeshData(md, allSamples)
              const bucketKey = `${materialKey}|${geometryKey}`

              let bucket = bucketMap.get(bucketKey)
              if (!bucket) {
                bucket = {
                  bucketKey,
                  geometryKey,
                  materialKey,
                  templateMd: md,
                  material: materialResolver.resolveForMeshData(md, allSamples, allRawMaterials),
                  matrices: [],
                }
                bucketMap.set(bucketKey, bucket)
              }

              bucket.matrices.push(toMatrix4(md.transform))
            }
          }
        }
      }

      // ---- Instancing audit (bucketKey = materialKey|geometryKey) ----
      logInstancingAuditSummary(bucketMap, { topN: 20 })

      // Build one shared geometry per bucket.
      const buckets: Bucket[] = []
      for (const b of bucketMap.values()) {
        const geometry = buildGeometryFromMeshData(b.templateMd, disposables)
        if (!geometry) continue
        buckets.push({
          bucketKey: b.bucketKey,
          geometry,
          material: b.material,
          matrices: b.matrices,
        })
      }

      if (cancelled) {
        for (const g of disposables.geometries) g.dispose()
        for (const m of disposables.materials) m.dispose()
        return
      }

      setBuild((prev) => {
        if (prev) {
          for (const g of prev.disposables.geometries) g.dispose()
          for (const m of prev.disposables.materials) m.dispose()
        }
        return { buckets, disposables }
      })

      // eslint-disable-next-line no-console
      console.log('[instanced-recreate] done', {
        buckets: buckets.length,
        instances: buckets.reduce((acc, b) => acc + b.matrices.length, 0),
      })
    }

    run().catch(console.error)

    return () => {
      cancelled = true
    }
  }, [batchSize, fragments, rebuildToken])

  const buckets = build?.buckets ?? []
  if (buckets.length === 0) return null

  const t = Number.isFinite(threshold) ? Math.max(1, Math.floor(threshold)) : 1
  const instancedBuckets = buckets.filter((b) => b.matrices.length > t)
  const uninstancedBuckets = buckets.filter((b) => b.matrices.length <= t)

  return (
    <>
      <Bvh firstHitOnly>
        <group name='instanced-recreated-root'>
          {instancedBuckets.map((b) => (
            <InstancedBucket key={b.bucketKey} bucket={b} onPick={setSelected} />
          ))}
          {uninstancedBuckets.map((b) => (
            <UninstancedBucketMeshes
            key={`${b.bucketKey}:uninstanced`}
            bucket={b}
            materialMode={uninstancedMaterial as 'original' | 'red'}
            onPick={setSelected}
            />
          ))}
        </group>
      </Bvh>

      {selected && (
        <mesh
          geometry={selected.geometry}
          matrix={selected.matrixWorld}
          matrixAutoUpdate={false}
          renderOrder={999}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
          <Outlines thickness={2} color='white' />
        </mesh>
      )}
    </>
  )
}

