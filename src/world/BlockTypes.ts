import * as THREE from 'three'
import type { BlockFaceName } from '../constants'

export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
  Glass = 5,
}

type FaceColorMap = Partial<Record<BlockFaceName, string>>

export interface BlockDefinition {
  id: BlockId
  label: string
  solid: boolean
  transparent: boolean
  baseColor: string
  faceColors?: FaceColorMap
}

export const BLOCK_DEFINITIONS: Record<BlockId, BlockDefinition> = {
  [BlockId.Air]: {
    id: BlockId.Air,
    label: 'Air',
    solid: false,
    transparent: true,
    baseColor: '#000000',
  },
  [BlockId.Grass]: {
    id: BlockId.Grass,
    label: 'Grass',
    solid: true,
    transparent: false,
    baseColor: '#6aa84f',
    faceColors: {
      py: '#81c35d',
      ny: '#6d4c31',
      px: '#71ae52',
      nx: '#71ae52',
      pz: '#71ae52',
      nz: '#71ae52',
    },
  },
  [BlockId.Dirt]: {
    id: BlockId.Dirt,
    label: 'Dirt',
    solid: true,
    transparent: false,
    baseColor: '#7a5230',
  },
  [BlockId.Stone]: {
    id: BlockId.Stone,
    label: 'Stone',
    solid: true,
    transparent: false,
    baseColor: '#8a939b',
  },
  [BlockId.Wood]: {
    id: BlockId.Wood,
    label: 'Wood',
    solid: true,
    transparent: false,
    baseColor: '#9a6a3a',
    faceColors: {
      py: '#c39257',
      ny: '#c39257',
      px: '#956639',
      nx: '#956639',
      pz: '#956639',
      nz: '#956639',
    },
  },
  [BlockId.Glass]: {
    id: BlockId.Glass,
    label: 'Glass',
    solid: true,
    transparent: true,
    baseColor: '#a9eaff',
  },
}

export const HOTBAR_BLOCKS = [
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Stone,
  BlockId.Wood,
  BlockId.Glass,
] as const

const FACE_SHADE: Record<BlockFaceName, number> = {
  px: 0.9,
  nx: 0.82,
  py: 1,
  ny: 0.58,
  pz: 0.86,
  nz: 0.76,
}

export function getBlockDefinition(block: BlockId): BlockDefinition {
  return BLOCK_DEFINITIONS[block]
}

export function isSolidBlock(block: BlockId): boolean {
  return getBlockDefinition(block).solid
}

export function getFaceColor(block: BlockId, face: BlockFaceName): THREE.Color {
  const definition = getBlockDefinition(block)
  const color = new THREE.Color(definition.faceColors?.[face] ?? definition.baseColor)
  return color.multiplyScalar(FACE_SHADE[face])
}
