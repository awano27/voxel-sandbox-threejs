import * as THREE from 'three'
import { CHUNK_HEIGHT, PLAYER_EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, WORLD_SEED } from '../constants'
import { BlockId, isSolidBlock } from './BlockTypes'
import { ChunkManager } from './ChunkManager'
import { TerrainGenerator } from './TerrainGenerator'

export class World {
  readonly generator: TerrainGenerator
  readonly chunkManager: ChunkManager

  constructor(scene: THREE.Scene) {
    this.generator = new TerrainGenerator(WORLD_SEED)
    this.chunkManager = new ChunkManager(this.generator)
    scene.add(this.chunkManager.root)
  }

  primeAround(position: THREE.Vector3): void {
    this.chunkManager.primeAround(position.x, position.z)
  }

  update(position: THREE.Vector3): void {
    this.chunkManager.update(position.x, position.z)
  }

  dispose(): void {
    this.chunkManager.dispose()
  }

  getSpawnPoint(): THREE.Vector3 {
    const x = 8
    const z = 8
    const groundY = this.generator.getTerrainHeight(x, z)
    return new THREE.Vector3(x + 0.5, groundY + PLAYER_EYE_HEIGHT + 1.5, z + 0.5)
  }

  getLoadedChunkCount(): number {
    return this.chunkManager.getLoadedChunkCount()
  }

  getTerrainHeight(x: number, z: number): number {
    return this.generator.getTerrainHeight(x, z)
  }

  getBlock(x: number, y: number, z: number): BlockId {
    return this.chunkManager.getBlock(x, y, z)
  }

  setBlock(x: number, y: number, z: number, block: BlockId): boolean {
    return this.chunkManager.setBlock(x, y, z, block)
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.getBlock(x, y, z))
  }

  canOccupy(position: THREE.Vector3): boolean {
    const minX = Math.floor(position.x - PLAYER_HALF_WIDTH)
    const maxX = Math.floor(position.x + PLAYER_HALF_WIDTH)
    const minY = Math.floor(position.y - PLAYER_EYE_HEIGHT)
    const maxY = Math.floor(position.y - PLAYER_EYE_HEIGHT + PLAYER_HEIGHT - 0.001)
    const minZ = Math.floor(position.z - PLAYER_HALF_WIDTH)
    const maxZ = Math.floor(position.z + PLAYER_HALF_WIDTH)

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (this.isSolidAt(x, y, z)) {
            return false
          }
        }
      }
    }

    return true
  }

  isWithinBuildHeight(y: number): boolean {
    return y >= 0 && y < CHUNK_HEIGHT
  }
}
