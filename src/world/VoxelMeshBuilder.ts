import * as THREE from 'three'
import { BLOCK_FACE_NAMES, CHUNK_HEIGHT, CHUNK_SIZE, type BlockFaceName } from '../constants'
import { BlockId, getBlockDefinition, getFaceColor } from './BlockTypes'
import type { Chunk } from './Chunk'

interface FaceDefinition {
  readonly name: BlockFaceName
  readonly normal: readonly [number, number, number]
  readonly neighborOffset: readonly [number, number, number]
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ]
}

interface GeometryBuffers {
  positions: number[]
  normals: number[]
  colors: number[]
  indices: number[]
  vertexCount: number
}

export interface ChunkGeometrySet {
  opaque: THREE.BufferGeometry | null
  transparent: THREE.BufferGeometry | null
}

const FACE_DEFINITIONS: Record<BlockFaceName, FaceDefinition> = {
  px: {
    name: 'px',
    normal: [1, 0, 0],
    neighborOffset: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  nx: {
    name: 'nx',
    normal: [-1, 0, 0],
    neighborOffset: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  py: {
    name: 'py',
    normal: [0, 1, 0],
    neighborOffset: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  ny: {
    name: 'ny',
    normal: [0, -1, 0],
    neighborOffset: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  pz: {
    name: 'pz',
    normal: [0, 0, 1],
    neighborOffset: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  nz: {
    name: 'nz',
    normal: [0, 0, -1],
    neighborOffset: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
}

export function buildChunkGeometry(
  chunk: Chunk,
  getBlockAt: (worldX: number, y: number, worldZ: number) => BlockId,
): ChunkGeometrySet {
  const opaqueBuffers = createGeometryBuffers()
  const transparentBuffers = createGeometryBuffers()
  const chunkWorldX = chunk.chunkX * CHUNK_SIZE
  const chunkWorldZ = chunk.chunkZ * CHUNK_SIZE

  for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
    for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        const block = chunk.get(localX, y, localZ)

        if (block === BlockId.Air) {
          continue
        }

        const blockDefinition = getBlockDefinition(block)
        const worldX = chunkWorldX + localX
        const worldZ = chunkWorldZ + localZ
        const target = blockDefinition.transparent ? transparentBuffers : opaqueBuffers

        for (const faceName of BLOCK_FACE_NAMES) {
          const face = FACE_DEFINITIONS[faceName]
          const [offsetX, offsetY, offsetZ] = face.neighborOffset
          const neighbor = getBlockAt(worldX + offsetX, y + offsetY, worldZ + offsetZ)

          if (!shouldRenderFace(block, neighbor)) {
            continue
          }

          pushFace(target, block, face, worldX, y, worldZ)
        }
      }
    }
  }

  return {
    opaque: toGeometry(opaqueBuffers),
    transparent: toGeometry(transparentBuffers),
  }
}

function shouldRenderFace(block: BlockId, neighbor: BlockId): boolean {
  if (neighbor === BlockId.Air) {
    return true
  }

  const source = getBlockDefinition(block)
  const adjacent = getBlockDefinition(neighbor)

  if (source.transparent) {
    return !adjacent.solid
  }

  return adjacent.transparent
}

function createGeometryBuffers(): GeometryBuffers {
  return {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    vertexCount: 0,
  }
}

function pushFace(
  buffers: GeometryBuffers,
  block: BlockId,
  face: FaceDefinition,
  worldX: number,
  y: number,
  worldZ: number,
): void {
  const faceColor = getFaceColor(block, face.name)
  const baseVertex = buffers.vertexCount

  for (const corner of face.corners) {
    const [cornerX, cornerY, cornerZ] = corner
    const [normalX, normalY, normalZ] = face.normal

    buffers.positions.push(worldX + cornerX, y + cornerY, worldZ + cornerZ)
    buffers.normals.push(normalX, normalY, normalZ)
    buffers.colors.push(faceColor.r, faceColor.g, faceColor.b)
  }

  buffers.indices.push(
    baseVertex,
    baseVertex + 1,
    baseVertex + 2,
    baseVertex,
    baseVertex + 2,
    baseVertex + 3,
  )
  buffers.vertexCount += 4
}

function toGeometry(buffers: GeometryBuffers): THREE.BufferGeometry | null {
  if (buffers.indices.length === 0) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))
  geometry.setIndex(buffers.indices)
  geometry.computeBoundingSphere()
  return geometry
}
