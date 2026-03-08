import * as THREE from 'three'
import { PLAYER_EYE_HEIGHT } from '../constants'
import type { Player } from '../player/Player'
import { BlockId } from '../world/BlockTypes'
import type { World } from '../world/World'

export type PlaygroundEvent =
  | { type: 'star-collected'; collected: number; total: number }
  | { type: 'all-stars-collected'; total: number }
  | { type: 'pad-used' }
  | { type: 'goal-reached' }

interface StarPickup {
  mesh: THREE.Group
  position: THREE.Vector3
  collected: boolean
  spinOffset: number
}

interface LaunchPad {
  mesh: THREE.Group
  center: THREE.Vector3
  topY: number
  used: boolean
  cooldown: number
}

export class Playground {
  readonly root = new THREE.Group()
  private readonly stars: StarPickup[] = []
  private readonly pads: LaunchPad[] = []
  private goalOrb!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  private goalRing!: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  private readonly goalPosition: THREE.Vector3
  private readonly spawnBase: THREE.Vector3
  private allStarsCollected = false
  private goalReached = false

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    spawnPosition: THREE.Vector3,
  ) {
    this.root.name = 'playground'
    scene.add(this.root)
    this.spawnBase = new THREE.Vector3(Math.floor(spawnPosition.x), 0, Math.floor(spawnPosition.z))
    this.stampWorldDecor()
    this.createStars()
    this.createPads()
    this.goalPosition = this.createGoalBeacon()
  }

  dispose(): void {
    for (const child of this.root.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        child.material.dispose()
      }

      if (child instanceof THREE.Group) {
        child.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.geometry.dispose()
            node.material.dispose()
          }
        })
      }
    }

    this.root.removeFromParent()
  }

  update(deltaSeconds: number, player: Player, elapsedSeconds: number): PlaygroundEvent[] {
    const events: PlaygroundEvent[] = []

    for (const star of this.stars) {
      if (!star.collected) {
        star.mesh.position.y = star.position.y + Math.sin(elapsedSeconds * 2.8 + star.spinOffset) * 0.18
        star.mesh.rotation.y += deltaSeconds * 2.5
        star.mesh.rotation.z += deltaSeconds * 0.8

        if (player.position.distanceTo(star.mesh.position) < 1.8) {
          star.collected = true
          star.mesh.visible = false
          const collected = this.stars.filter((entry) => entry.collected).length
          events.push({ type: 'star-collected', collected, total: this.stars.length })

          if (collected === this.stars.length && !this.allStarsCollected) {
            this.allStarsCollected = true
            events.push({ type: 'all-stars-collected', total: this.stars.length })
          }
        }
      }
    }

    for (const pad of this.pads) {
      pad.cooldown = Math.max(0, pad.cooldown - deltaSeconds)
      pad.mesh.rotation.y += deltaSeconds * 0.65

      const feetY = player.position.y - PLAYER_EYE_HEIGHT
      const horizontalDistance = Math.hypot(player.position.x - pad.center.x, player.position.z - pad.center.z)
      const isOnPad = horizontalDistance < 1 && Math.abs(feetY - pad.topY) < 1.15

      if (pad.cooldown === 0 && isOnPad && player.isGrounded) {
        pad.used = true
        pad.cooldown = 1.4
        player.velocity.y = Math.max(player.velocity.y, 12.6)
        player.velocity.z = Math.max(player.velocity.z, 4.2)
        events.push({ type: 'pad-used' })
      }
    }

    this.goalOrb.position.y = this.goalPosition.y + Math.sin(elapsedSeconds * 1.8) * 0.25
    this.goalRing.rotation.x = elapsedSeconds * 1.1
    this.goalRing.rotation.y = elapsedSeconds * 0.8

    if (!this.goalReached && this.allStarsCollected && player.position.distanceTo(this.goalPosition) < 2.35) {
      this.goalReached = true
      events.push({ type: 'goal-reached' })
    }

    return events
  }

  getState(): { starsCollected: number; starsTotal: number; padsUsed: number; goalReached: boolean } {
    return {
      starsCollected: this.stars.filter((entry) => entry.collected).length,
      starsTotal: this.stars.length,
      padsUsed: this.pads.filter((entry) => entry.used).length,
      goalReached: this.goalReached,
    }
  }

  private stampWorldDecor(): void {
    const pathOffsets = [
      new THREE.Vector2(0, 2),
      new THREE.Vector2(0, 4),
      new THREE.Vector2(0, 6),
      new THREE.Vector2(1, 8),
      new THREE.Vector2(2, 10),
      new THREE.Vector2(3, 12),
      new THREE.Vector2(4, 14),
    ]

    for (const offset of pathOffsets) {
      this.paintSurfaceTile(this.spawnBase.x + offset.x, this.spawnBase.z + offset.y, BlockId.Glass)
    }

    this.buildLaunchPad(this.spawnBase.x, this.spawnBase.z + 6)
    this.buildGoalTower(this.spawnBase.x + 4, this.spawnBase.z + 14)
  }

  private createStars(): void {
    const starGeometry = new THREE.IcosahedronGeometry(0.34, 0)
    const starMaterial = new THREE.MeshStandardMaterial({
      color: '#ffe56f',
      emissive: '#ffcb3b',
      emissiveIntensity: 1.1,
      roughness: 0.3,
      metalness: 0.2,
    })

    const glowGeometry = new THREE.TorusGeometry(0.45, 0.08, 12, 32)
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: '#fff7c2',
      emissive: '#ffd166',
      emissiveIntensity: 0.85,
      roughness: 0.4,
      metalness: 0.1,
    })

    const positions = [
      new THREE.Vector2(0.5, 1.8),
      new THREE.Vector2(0.5, 3.6),
      new THREE.Vector2(0.5, 5.4),
      new THREE.Vector2(1.5, 8.5),
      new THREE.Vector2(3.5, 12.5),
    ]

    positions.forEach((offset, index) => {
      const worldX = this.spawnBase.x + offset.x
      const worldZ = this.spawnBase.z + offset.y
      const worldY = this.world.getTerrainHeight(Math.floor(worldX), Math.floor(worldZ)) + 2.55 + index * 0.05
      const group = new THREE.Group()
      group.position.set(worldX, worldY, worldZ)

      const star = new THREE.Mesh(starGeometry, starMaterial.clone())
      const glow = new THREE.Mesh(glowGeometry, glowMaterial.clone())
      glow.rotation.x = Math.PI / 2
      group.add(star, glow)
      this.root.add(group)

      this.stars.push({
        mesh: group,
        position: group.position.clone(),
        collected: false,
        spinOffset: index * 0.65,
      })
    })
  }

  private createPads(): void {
    const geometry = new THREE.CylinderGeometry(1.15, 1.35, 0.36, 6)
    const material = new THREE.MeshStandardMaterial({
      color: '#ff8d5c',
      emissive: '#ff6b2d',
      emissiveIntensity: 0.72,
      roughness: 0.45,
      metalness: 0.15,
    })

    const ringGeometry = new THREE.TorusGeometry(1.02, 0.08, 10, 30)
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: '#fff4cb',
      emissive: '#ffd166',
      emissiveIntensity: 0.65,
      roughness: 0.5,
      metalness: 0.15,
    })

    const padWorldX = this.spawnBase.x + 0.5
    const padWorldZ = this.spawnBase.z + 6.5
    const topY = this.world.getTerrainHeight(Math.floor(padWorldX), Math.floor(padWorldZ)) + 1.02

    const group = new THREE.Group()
    group.position.set(padWorldX, topY, padWorldZ)

    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = 0.18
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.44
    group.add(mesh, ring)
    this.root.add(group)

    this.pads.push({
      mesh: group,
      center: new THREE.Vector3(padWorldX, topY, padWorldZ),
      topY,
      used: false,
      cooldown: 0,
    })
  }

  private createGoalBeacon(): THREE.Vector3 {
    const goalX = this.spawnBase.x + 4.5
    const goalZ = this.spawnBase.z + 14.5
    const topY = this.world.getTerrainHeight(Math.floor(goalX), Math.floor(goalZ)) + 4.6

    const orbGeometry = new THREE.SphereGeometry(0.48, 16, 16)
    const orbMaterial = new THREE.MeshStandardMaterial({
      color: '#9ef7ff',
      emissive: '#59f0ff',
      emissiveIntensity: 1,
      roughness: 0.25,
      metalness: 0.1,
    })
    this.goalOrb = new THREE.Mesh(orbGeometry, orbMaterial)
    this.goalOrb.position.set(goalX, topY, goalZ)

    const ringGeometry = new THREE.TorusGeometry(1.2, 0.09, 12, 48)
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: '#fff5d9',
      emissive: '#ffd166',
      emissiveIntensity: 0.75,
      roughness: 0.4,
      metalness: 0.18,
    })
    this.goalRing = new THREE.Mesh(ringGeometry, ringMaterial)
    this.goalRing.position.copy(this.goalOrb.position)

    this.root.add(this.goalOrb, this.goalRing)
    return this.goalOrb.position.clone()
  }

  private paintSurfaceTile(worldX: number, worldZ: number, block: BlockId): void {
    const y = this.world.getTerrainHeight(worldX, worldZ)
    this.world.setBlock(worldX, y, worldZ, block)
    this.world.setBlock(worldX, y + 1, worldZ, BlockId.Air)
  }

  private buildLaunchPad(worldX: number, worldZ: number): void {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const currentX = worldX + dx
        const currentZ = worldZ + dz
        const y = this.world.getTerrainHeight(currentX, currentZ)
        const block = dx === 0 && dz === 0 ? BlockId.Glass : Math.abs(dx) + Math.abs(dz) === 2 ? BlockId.Wood : BlockId.Stone
        this.world.setBlock(currentX, y, currentZ, block)
        this.world.setBlock(currentX, y + 1, currentZ, BlockId.Air)
      }
    }
  }

  private buildGoalTower(worldX: number, worldZ: number): void {
    const baseY = this.world.getTerrainHeight(worldX, worldZ)

    for (let y = 0; y < 4; y += 1) {
      this.world.setBlock(worldX, baseY + y, worldZ, BlockId.Wood)
    }

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        this.world.setBlock(worldX + dx, baseY + 4, worldZ + dz, Math.abs(dx) + Math.abs(dz) === 2 ? BlockId.Glass : BlockId.Wood)
      }
    }
  }
}
