import { Matrix4 } from 'three'

export function toMatrix4(t: unknown): Matrix4 {
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

