import * as THREE from 'three'
import { BlockId } from './BlockTypes'

export interface VoxelHit {
  block: THREE.Vector3
  adjacent: THREE.Vector3
  normal: THREE.Vector3
  distance: number
}

// Walk the voxel grid cell-by-cell instead of intersecting chunk meshes.
export function traceVoxelRay(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  getBlockAt: (x: number, y: number, z: number) => BlockId,
): VoxelHit | null {
  const ray = direction.clone().normalize()
  const current = new THREE.Vector3(
    Math.floor(origin.x),
    Math.floor(origin.y),
    Math.floor(origin.z),
  )
  const previous = current.clone()
  const normal = new THREE.Vector3()

  const stepX = Math.sign(ray.x)
  const stepY = Math.sign(ray.y)
  const stepZ = Math.sign(ray.z)

  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.x)
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.y)
  const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.z)

  let tMaxX = initialTMax(origin.x, current.x, stepX, ray.x)
  let tMaxY = initialTMax(origin.y, current.y, stepY, ray.y)
  let tMaxZ = initialTMax(origin.z, current.z, stepZ, ray.z)
  let traveled = 0

  while (traveled <= maxDistance) {
    const block = getBlockAt(current.x, current.y, current.z)

    if (block !== BlockId.Air) {
      return {
        block: current.clone(),
        adjacent: previous.clone(),
        normal: normal.clone(),
        distance: traveled,
      }
    }

    previous.copy(current)

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      current.x += stepX
      traveled = tMaxX
      tMaxX += tDeltaX
      normal.set(-stepX, 0, 0)
      continue
    }

    if (tMaxY < tMaxZ) {
      current.y += stepY
      traveled = tMaxY
      tMaxY += tDeltaY
      normal.set(0, -stepY, 0)
      continue
    }

    current.z += stepZ
    traveled = tMaxZ
    tMaxZ += tDeltaZ
    normal.set(0, 0, -stepZ)
  }

  return null
}

function initialTMax(origin: number, voxel: number, step: number, direction: number): number {
  if (step === 0 || direction === 0) {
    return Number.POSITIVE_INFINITY
  }

  const boundary = step > 0 ? voxel + 1 : voxel
  return Math.abs((boundary - origin) / direction)
}
