import { CHUNK_HEIGHT, CHUNK_SIZE } from '../constants'
import { BlockId } from './BlockTypes'
import { TerrainGenerator } from './TerrainGenerator'

export class Chunk {
  readonly chunkX: number
  readonly chunkZ: number
  readonly blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT)

  constructor(chunkX: number, chunkZ: number) {
    this.chunkX = chunkX
    this.chunkZ = chunkZ
  }

  generate(generator: TerrainGenerator): void {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
        const worldX = this.chunkX * CHUNK_SIZE + localX
        const worldZ = this.chunkZ * CHUNK_SIZE + localZ

        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          this.set(localX, y, localZ, generator.getBlockAt(worldX, y, worldZ))
        }
      }
    }
  }

  get(localX: number, y: number, localZ: number): BlockId {
    return this.blocks[getIndex(localX, y, localZ)] as BlockId
  }

  set(localX: number, y: number, localZ: number, block: BlockId): void {
    this.blocks[getIndex(localX, y, localZ)] = block
  }
}

function getIndex(localX: number, y: number, localZ: number): number {
  return localX + CHUNK_SIZE * (localZ + CHUNK_SIZE * y)
}
