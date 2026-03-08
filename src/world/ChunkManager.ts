import * as THREE from 'three'
import { CHUNK_HEIGHT, CHUNK_SIZE, RENDER_RADIUS } from '../constants'
import { BlockId } from './BlockTypes'
import { Chunk } from './Chunk'
import { TerrainGenerator } from './TerrainGenerator'
import { buildChunkGeometry } from './VoxelMeshBuilder'

interface ChunkRecord {
  chunk: Chunk
  group: THREE.Group
}

export class ChunkManager {
  readonly root = new THREE.Group()
  private readonly chunks = new Map<string, ChunkRecord>()
  private readonly buildQueue: string[] = []
  private readonly queued = new Set<string>()
  private readonly generator: TerrainGenerator
  private readonly opaqueMaterial: THREE.MeshLambertMaterial
  private readonly transparentMaterial: THREE.MeshLambertMaterial

  constructor(generator: TerrainGenerator) {
    this.generator = generator
    this.root.name = 'voxel-world'

    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
    })
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })
  }

  primeAround(worldX: number, worldZ: number): void {
    const chunkX = worldToChunkCoord(worldX)
    const chunkZ = worldToChunkCoord(worldZ)
    this.ensureChunksAround(chunkX, chunkZ)
    this.flushBuildQueue(18)
  }

  update(worldX: number, worldZ: number): void {
    const chunkX = worldToChunkCoord(worldX)
    const chunkZ = worldToChunkCoord(worldZ)
    this.ensureChunksAround(chunkX, chunkZ)
    this.unloadFarChunks(chunkX, chunkZ)
    this.flushBuildQueue(2)
  }

  getLoadedChunkCount(): number {
    return this.chunks.size
  }

  getBlock(worldX: number, y: number, worldZ: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) {
      return BlockId.Air
    }

    const chunk = this.getChunk(worldToChunkCoord(worldX), worldToChunkCoord(worldZ))

    if (!chunk) {
      return BlockId.Air
    }

    return chunk.get(localCoord(worldX), y, localCoord(worldZ))
  }

  setBlock(worldX: number, y: number, worldZ: number, block: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) {
      return false
    }

    const chunkX = worldToChunkCoord(worldX)
    const chunkZ = worldToChunkCoord(worldZ)
    const chunk = this.ensureChunk(chunkX, chunkZ)

    chunk.set(localCoord(worldX), y, localCoord(worldZ), block)
    this.queueChunkBuild(chunkX, chunkZ)

    const localX = localCoord(worldX)
    const localZ = localCoord(worldZ)

    if (localX === 0) this.queueChunkBuild(chunkX - 1, chunkZ)
    if (localX === CHUNK_SIZE - 1) this.queueChunkBuild(chunkX + 1, chunkZ)
    if (localZ === 0) this.queueChunkBuild(chunkX, chunkZ - 1)
    if (localZ === CHUNK_SIZE - 1) this.queueChunkBuild(chunkX, chunkZ + 1)

    return true
  }

  dispose(): void {
    for (const record of this.chunks.values()) {
      disposeChunkGroup(record.group)
    }

    this.opaqueMaterial.dispose()
    this.transparentMaterial.dispose()
  }

  private ensureChunksAround(centerChunkX: number, centerChunkZ: number): void {
    for (let chunkZ = centerChunkZ - RENDER_RADIUS; chunkZ <= centerChunkZ + RENDER_RADIUS; chunkZ += 1) {
      for (let chunkX = centerChunkX - RENDER_RADIUS; chunkX <= centerChunkX + RENDER_RADIUS; chunkX += 1) {
        this.ensureChunk(chunkX, chunkZ)
      }
    }
  }

  private ensureChunk(chunkX: number, chunkZ: number): Chunk {
    const key = chunkKey(chunkX, chunkZ)
    const existing = this.chunks.get(key)

    if (existing) {
      return existing.chunk
    }

    const chunk = new Chunk(chunkX, chunkZ)
    chunk.generate(this.generator)

    const group = new THREE.Group()
    group.name = `chunk-${chunkX}-${chunkZ}`
    this.root.add(group)

    this.chunks.set(key, { chunk, group })
    this.queueChunkBuild(chunkX, chunkZ)

    return chunk
  }

  private getChunk(chunkX: number, chunkZ: number): Chunk | null {
    return this.chunks.get(chunkKey(chunkX, chunkZ))?.chunk ?? null
  }

  private queueChunkBuild(chunkX: number, chunkZ: number): void {
    const key = chunkKey(chunkX, chunkZ)

    if (!this.chunks.has(key) || this.queued.has(key)) {
      return
    }

    this.queued.add(key)
    this.buildQueue.push(key)
  }

  private flushBuildQueue(budget: number): void {
    for (let buildCount = 0; buildCount < budget; buildCount += 1) {
      const key = this.buildQueue.shift()

      if (!key) {
        return
      }

      this.queued.delete(key)
      const record = this.chunks.get(key)

      if (!record) {
        continue
      }

      rebuildChunk(record, this.opaqueMaterial, this.transparentMaterial, (worldX, y, worldZ) =>
        this.getBlock(worldX, y, worldZ),
      )
    }
  }

  private unloadFarChunks(centerChunkX: number, centerChunkZ: number): void {
    for (const [key, record] of this.chunks.entries()) {
      const dx = Math.abs(record.chunk.chunkX - centerChunkX)
      const dz = Math.abs(record.chunk.chunkZ - centerChunkZ)

      if (dx <= RENDER_RADIUS + 1 && dz <= RENDER_RADIUS + 1) {
        continue
      }

      disposeChunkGroup(record.group)
      this.root.remove(record.group)
      this.chunks.delete(key)
      this.queued.delete(key)
    }
  }
}

function rebuildChunk(
  record: ChunkRecord,
  opaqueMaterial: THREE.MeshLambertMaterial,
  transparentMaterial: THREE.MeshLambertMaterial,
  getBlockAt: (worldX: number, y: number, worldZ: number) => BlockId,
): void {
  disposeChunkGroup(record.group)
  const geometry = buildChunkGeometry(record.chunk, getBlockAt)

  if (geometry.opaque) {
    const opaqueMesh = new THREE.Mesh(geometry.opaque, opaqueMaterial)
    opaqueMesh.matrixAutoUpdate = false
    opaqueMesh.updateMatrix()
    opaqueMesh.frustumCulled = true
    record.group.add(opaqueMesh)
  }

  if (geometry.transparent) {
    const transparentMesh = new THREE.Mesh(geometry.transparent, transparentMaterial)
    transparentMesh.renderOrder = 1
    transparentMesh.matrixAutoUpdate = false
    transparentMesh.updateMatrix()
    transparentMesh.frustumCulled = true
    record.group.add(transparentMesh)
  }
}

function disposeChunkGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
    }
  }

  group.clear()
}

function chunkKey(chunkX: number, chunkZ: number): string {
  return `${chunkX},${chunkZ}`
}

export function worldToChunkCoord(worldCoord: number): number {
  return Math.floor(worldCoord / CHUNK_SIZE)
}

function localCoord(worldCoord: number): number {
  return ((worldCoord % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
}
