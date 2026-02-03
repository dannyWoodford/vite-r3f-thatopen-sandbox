// Utilities for identifying "instancing buckets".
// A bucket is typically (materialKey + geometryKey).
//
// Notes:
// - These keys are for grouping/auditing and early instancing work.
// - They are NOT cryptographic and are not guaranteed globally unique.
// - The geometry key uses sampling so it is fast; collisions are possible but rare enough for audit.

// Fast, low-collision-enough hash for audit/reporting (NOT crypto, not guaranteed unique).
function fnv1a32Update(hash: number, v: number) {
  // Force into uint32 and mix.
  hash ^= v >>> 0
  // FNV prime 16777619
  return (hash * 16777619) >>> 0
}

function hashSampledArrayLike(a: ArrayLike<number> | null | undefined, maxSamples: number) {
  if (!a || a.length === 0) return 0
  let hash = 2166136261 >>> 0
  const n = a.length
  const step = Math.max(1, Math.floor(n / maxSamples))
  for (let i = 0; i < n; i += step) {
    const v = a[i]
    // Quantize floats deterministically; ok for grouping identical buffers.
    const q = (typeof v === 'number' ? (v * 1e6) | 0 : 0) >>> 0
    hash = fnv1a32Update(hash, q)
  }
  hash = fnv1a32Update(hash, n)
  return hash >>> 0
}

export function getGeometryKeyFromMeshData(meshData: any) {
  const positions = meshData?.positions as ArrayLike<number> | null | undefined
  const indices = meshData?.indices as ArrayLike<number> | null | undefined
  const pLen = positions?.length ?? 0
  const iLen = indices?.length ?? 0
  // Sample both arrays so we don't have to hash everything for a quick audit.
  const pHash = hashSampledArrayLike(positions, 64)
  const iHash = hashSampledArrayLike(indices, 64)
  return `p${pLen}:i${iLen}:ph${pHash.toString(16)}:ih${iHash.toString(16)}`
}

// Returns a stable-enough key for grouping by material.
// In our current pipeline material ultimately resolves from sampleId -> materialId.
export function getMaterialKeyFromMeshData(meshData: any, allSamples: any) {
  const sampleId = meshData?.sampleId
  if (typeof sampleId !== 'number') return 'fallback'
  const sample = allSamples?.get(sampleId)
  const materialId = sample?.material
  if (typeof materialId !== 'number') return 'fallback'
  return `mat:${materialId}`
}

