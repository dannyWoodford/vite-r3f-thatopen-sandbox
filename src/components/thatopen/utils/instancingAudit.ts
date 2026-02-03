type BucketLike = {
  bucketKey: string
  matrices: ArrayLike<unknown>
}

export type InstancingAuditSummary = {
  totalParts: number
  uniqueBuckets_geometryPlusMaterial: number
  uniqueParts_singletons: number
  nonUniqueParts_repeated: number
  singletonBuckets: number
  repeatedBuckets: number
  bucketSizeHistogram: Record<'1' | '2' | '3-5' | '6-10' | '11-50' | '51-200' | '201+', number>
  topRepeatedBuckets: Array<{ bucketKey: string; instances: number }>
}

export function computeInstancingAuditSummary(
  bucketMap: Map<string, BucketLike>,
  options?: { topN?: number }
): InstancingAuditSummary {
  const topN = options?.topN ?? 20

  const values = Array.from(bucketMap.values())
  const totalParts = values.reduce((acc, b) => acc + b.matrices.length, 0)
  const uniqueBuckets = bucketMap.size
  const singletonBuckets = values.reduce((acc, b) => acc + (b.matrices.length === 1 ? 1 : 0), 0)
  const repeatedBuckets = uniqueBuckets - singletonBuckets
  const uniqueParts = singletonBuckets
  const nonUniqueParts = totalParts - uniqueParts

  const bucketSizeHistogram: InstancingAuditSummary['bucketSizeHistogram'] = {
    '1': 0,
    '2': 0,
    '3-5': 0,
    '6-10': 0,
    '11-50': 0,
    '51-200': 0,
    '201+': 0,
  }

  for (const b of values) {
    const n = b.matrices.length
    if (n === 1) bucketSizeHistogram['1']++
    else if (n === 2) bucketSizeHistogram['2']++
    else if (n <= 5) bucketSizeHistogram['3-5']++
    else if (n <= 10) bucketSizeHistogram['6-10']++
    else if (n <= 50) bucketSizeHistogram['11-50']++
    else if (n <= 200) bucketSizeHistogram['51-200']++
    else bucketSizeHistogram['201+']++
  }

  const topRepeatedBuckets = values
    .filter((b) => b.matrices.length > 1)
    .sort((a, b) => b.matrices.length - a.matrices.length)
    .slice(0, topN)
    .map((b) => ({ bucketKey: b.bucketKey, instances: b.matrices.length }))

  return {
    totalParts,
    uniqueBuckets_geometryPlusMaterial: uniqueBuckets,
    uniqueParts_singletons: uniqueParts,
    nonUniqueParts_repeated: nonUniqueParts,
    singletonBuckets,
    repeatedBuckets,
    bucketSizeHistogram,
    topRepeatedBuckets,
  }
}

export function logInstancingAuditSummary(bucketMap: Map<string, BucketLike>, options?: { topN?: number }) {
  const summary = computeInstancingAuditSummary(bucketMap, options)

  // eslint-disable-next-line no-console
  console.groupCollapsed?.('[instancing-audit]')
  // eslint-disable-next-line no-console
  console.log({
    totalParts: summary.totalParts,
    uniqueBuckets_geometryPlusMaterial: summary.uniqueBuckets_geometryPlusMaterial,
    uniqueParts_singletons: summary.uniqueParts_singletons,
    nonUniqueParts_repeated: summary.nonUniqueParts_repeated,
    singletonBuckets: summary.singletonBuckets,
    repeatedBuckets: summary.repeatedBuckets,
  })
  // eslint-disable-next-line no-console
  console.log('[instancing-audit] bucket size histogram (buckets):', summary.bucketSizeHistogram)
  if (summary.topRepeatedBuckets.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[instancing-audit] top repeated buckets (bucketKey -> instances):')
    // eslint-disable-next-line no-console
    console.table?.(summary.topRepeatedBuckets)
  }
  // eslint-disable-next-line no-console
  console.groupEnd?.()
}

