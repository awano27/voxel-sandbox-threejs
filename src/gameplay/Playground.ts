import * as THREE from 'three'
import { PLAYER_EYE_HEIGHT } from '../constants'
import type { Player } from '../player/Player'
import { BlockId } from '../world/BlockTypes'
import type { World } from '../world/World'

export type PlaygroundEvent =
  | { type: 'star-collected'; collected: number; total: number }
  | { type: 'all-stars-collected'; total: number }
  | { type: 'pad-used' }
  | { type: 'ring-cleared' }
  | { type: 'crate-smashed' }
  | { type: 'bridge-progress'; placed: number; total: number }
  | { type: 'bridge-complete' }
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

interface RingGate {
  group: THREE.Group
  center: THREE.Vector3
  cleared: boolean
}

interface BridgeSlot {
  marker: THREE.Group
  blockPosition: THREE.Vector3
  filled: boolean
}

export interface PlaygroundState {
  starsCollected: number
  starsTotal: number
  padsUsed: number
  ringCleared: boolean
  bridgePlaced: number
  bridgeNeeded: number
  crateSmashed: boolean
  goalReached: boolean
}

export class Playground {
  readonly root = new THREE.Group()
  private readonly stars: StarPickup[] = []
  private readonly pads: LaunchPad[] = []
  private readonly bridgeSlots: BridgeSlot[] = []
  private readonly crateBlocks: THREE.Vector3[] = []
  private readonly courseForward = new THREE.Vector3(0, 0, -1)
  private readonly spawnBase: THREE.Vector3
  private readonly goalPosition: THREE.Vector3
  private readonly gate: RingGate
  private goalOrb!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  private goalRing!: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>
  private allStarsCollected = false
  private crateSmashed = false
  private bridgeComplete = false
  private goalReached = false

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    spawnPosition: THREE.Vector3,
  ) {
    this.root.name = 'playground'
    scene.add(this.root)
    this.spawnBase = new THREE.Vector3(Math.floor(spawnPosition.x), 0, Math.floor(spawnPosition.z))
    this.stampCourse()
    this.createStars()
    this.createPads()
    this.gate = this.createSkyRing()
    this.createBridgeSlots()
    this.createPartyCrate()
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
        star.mesh.rotation.y += deltaSeconds * 2.6
        star.mesh.rotation.z += deltaSeconds * 0.9

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
        pad.cooldown = 1.35
        player.velocity.y = Math.max(player.velocity.y, 11.8)
        player.velocity.x += this.courseForward.x * 6.6
        player.velocity.z += this.courseForward.z * 6.6
        events.push({ type: 'pad-used' })
      }
    }

    this.gate.group.rotation.z = Math.sin(elapsedSeconds * 0.8) * 0.1

    if (!this.gate.cleared && player.position.distanceTo(this.gate.center) < 1.55) {
      this.gate.cleared = true
      this.gate.group.visible = false
      events.push({ type: 'ring-cleared' })
    }

    if (!this.crateSmashed) {
      for (const block of this.crateBlocks) {
        if (this.world.getBlock(block.x, block.y, block.z) === BlockId.Air) {
          this.crateSmashed = true
          events.push({ type: 'crate-smashed' })
          break
        }
      }
    }

    let bridgeFilledCount = 0

    for (const slot of this.bridgeSlots) {
      const isFilled = this.world.getBlock(slot.blockPosition.x, slot.blockPosition.y, slot.blockPosition.z) !== BlockId.Air

      if (isFilled) {
        bridgeFilledCount += 1
      }

      if (isFilled !== slot.filled) {
        slot.filled = isFilled
        slot.marker.visible = !isFilled
        events.push({ type: 'bridge-progress', placed: bridgeFilledCount, total: this.bridgeSlots.length })
      }
    }

    if (!this.bridgeComplete && bridgeFilledCount === this.bridgeSlots.length) {
      this.bridgeComplete = true
      events.push({ type: 'bridge-complete' })
    }

    this.goalOrb.position.y = this.goalPosition.y + Math.sin(elapsedSeconds * 1.9) * 0.25
    this.goalRing.rotation.x = elapsedSeconds * 1.15
    this.goalRing.rotation.y = elapsedSeconds * 0.9

    const canFinish = this.allStarsCollected && this.gate.cleared && this.crateSmashed && this.bridgeComplete

    if (!this.goalReached && canFinish && player.position.distanceTo(this.goalPosition) < 2.5) {
      this.goalReached = true
      events.push({ type: 'goal-reached' })
    }

    return events
  }

  getState(): PlaygroundState {
    return {
      starsCollected: this.stars.filter((entry) => entry.collected).length,
      starsTotal: this.stars.length,
      padsUsed: this.pads.filter((entry) => entry.used).length,
      ringCleared: this.gate.cleared,
      bridgePlaced: this.bridgeSlots.filter((entry) => entry.filled).length,
      bridgeNeeded: this.bridgeSlots.length,
      crateSmashed: this.crateSmashed,
      goalReached: this.goalReached,
    }
  }

  getGoalPosition(): THREE.Vector3 {
    return this.goalPosition.clone()
  }

  private stampCourse(): void {
    const trail = [
      [0, 1, BlockId.Glass],
      [0, 3, BlockId.Glass],
      [0, 5, BlockId.Glass],
      [0, 7, BlockId.Stone],
      [0, 9, BlockId.Glass],
      [0, 11, BlockId.Glass],
      [0, 13, BlockId.Wood],
      [0, 14, BlockId.Air],
      [0, 15, BlockId.Air],
      [0, 16, BlockId.Wood],
      [0, 18, BlockId.Glass],
      [0, 20, BlockId.Stone],
      [2, 23, BlockId.Wood],
    ] as const

    for (const [side, forward, block] of trail) {
      const [worldX, worldZ] = this.courseCell(side, forward)
      if (block !== BlockId.Air) {
        this.paintSurfaceTile(worldX, worldZ, block)
      }
    }

    this.buildLaunchPad(0, 7)
    this.buildBridgePlatforms()
    this.buildPartyCrateBase()
    this.buildGoalTower(2, 23)
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
      [0.5, 1.5],
      [0.5, 3.5],
      [0.5, 5.5],
      [0.5, 10.2],
      [0.5, 18.8],
      [2.5, 23.2],
    ] as const

    positions.forEach(([side, forward], index) => {
      const [worldX, worldZ] = this.courseFloat(side, forward)
      const worldY = this.world.getTerrainHeight(Math.floor(worldX), Math.floor(worldZ)) + 2.6 + index * 0.04
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
    const geometry = new THREE.CylinderGeometry(1.12, 1.34, 0.36, 6)
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

    const [padWorldX, padWorldZ] = this.courseFloat(0.5, 7.5)
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

  private createSkyRing(): RingGate {
    const [worldX, worldZ] = this.courseFloat(0.5, 10.5)
    const baseY = this.world.getTerrainHeight(Math.floor(worldX), Math.floor(worldZ))
    const center = new THREE.Vector3(worldX, baseY + 4.9, worldZ)

    const group = new THREE.Group()
    group.position.copy(center)

    const ringGeometry = new THREE.TorusGeometry(1.42, 0.14, 12, 48)
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: '#8fe6ff',
      emissive: '#58d6ff',
      emissiveIntensity: 1,
      roughness: 0.35,
      metalness: 0.15,
    })
    const sparkGeometry = new THREE.SphereGeometry(0.1, 10, 10)
    const sparkMaterial = new THREE.MeshStandardMaterial({
      color: '#fff7d1',
      emissive: '#ffd166',
      emissiveIntensity: 0.85,
      roughness: 0.4,
      metalness: 0.1,
    })

    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.y = Math.PI / 2
    group.add(ring)

    for (let index = 0; index < 4; index += 1) {
      const spark = new THREE.Mesh(sparkGeometry, sparkMaterial.clone())
      const angle = (Math.PI * 2 * index) / 4
      spark.position.set(Math.cos(angle) * 1.55, Math.sin(angle) * 1.55, 0)
      group.add(spark)
    }

    this.root.add(group)
    return { group, center, cleared: false }
  }

  private createBridgeSlots(): void {
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: '#9ef7ff',
      emissive: '#59f0ff',
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.1,
      transparent: true,
      opacity: 0.45,
    })

    const slots = [
      this.courseCell(0, 14),
      this.courseCell(0, 15),
    ]

    for (const [worldX, worldZ] of slots) {
      const blockY = this.world.getTerrainHeight(worldX, worldZ) + 1
      this.world.setBlock(worldX, blockY, worldZ, BlockId.Air)
      this.world.setBlock(worldX, blockY + 1, worldZ, BlockId.Air)

      const marker = new THREE.Group()
      marker.position.set(worldX + 0.5, blockY + 0.5, worldZ + 0.5)

      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.94, 0.94), markerMaterial.clone())
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.54, 0.06, 10, 26),
        new THREE.MeshStandardMaterial({
          color: '#fff6cf',
          emissive: '#ffd166',
          emissiveIntensity: 0.6,
          roughness: 0.4,
          metalness: 0.1,
        }),
      )
      halo.rotation.x = Math.PI / 2
      marker.add(cube, halo)
      this.root.add(marker)

      this.bridgeSlots.push({
        marker,
        blockPosition: new THREE.Vector3(worldX, blockY, worldZ),
        filled: false,
      })
    }
  }

  private createPartyCrate(): void {
    const offsets = [
      [0, 18, 0],
      [1, 18, 0],
      [0, 18, 1],
      [1, 18, 1],
      [0, 19, 0],
      [1, 19, 0],
      [0, 19, 1],
      [1, 19, 1],
    ] as const

    offsets.forEach(([side, forward, sideShift]) => {
      const [worldX, worldZ] = this.courseCell(side + sideShift, forward)
      const y = this.world.getTerrainHeight(worldX, worldZ) + 1
      const block = (side + sideShift + forward) % 2 === 0 ? BlockId.Wood : BlockId.Glass
      this.world.setBlock(worldX, y, worldZ, block)
      this.crateBlocks.push(new THREE.Vector3(worldX, y, worldZ))
    })
  }

  private createGoalBeacon(): THREE.Vector3 {
    const [goalX, goalZ] = this.courseFloat(2.5, 23.5)
    const topY = this.world.getTerrainHeight(Math.floor(goalX), Math.floor(goalZ)) + 5.6

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
    this.world.setBlock(worldX, y + 2, worldZ, BlockId.Air)
  }

  private buildLaunchPad(side: number, forward: number): void {
    const center = this.courseCell(side, forward)

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const currentX = center[0] + dx
        const currentZ = center[1] + dz
        const y = this.world.getTerrainHeight(currentX, currentZ)
        const block =
          dx === 0 && dz === 0 ? BlockId.Glass : Math.abs(dx) + Math.abs(dz) === 2 ? BlockId.Wood : BlockId.Stone
        this.world.setBlock(currentX, y, currentZ, block)
        this.world.setBlock(currentX, y + 1, currentZ, BlockId.Air)
      }
    }
  }

  private buildBridgePlatforms(): void {
    for (const forward of [13, 16]) {
      const [centerX, centerZ] = this.courseCell(0, forward)

      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const worldX = centerX + dx
          const worldZ = centerZ + dz
          const y = this.world.getTerrainHeight(worldX, worldZ)
          this.world.setBlock(worldX, y, worldZ, Math.abs(dx) === 1 && Math.abs(dz) === 1 ? BlockId.Glass : BlockId.Wood)
          this.world.setBlock(worldX, y + 1, worldZ, BlockId.Air)
        }
      }
    }
  }

  private buildPartyCrateBase(): void {
    const [centerX, centerZ] = this.courseCell(0, 19)

    for (let dz = -1; dz <= 2; dz += 1) {
      for (let dx = -1; dx <= 2; dx += 1) {
        const worldX = centerX + dx
        const worldZ = centerZ + dz
        const y = this.world.getTerrainHeight(worldX, worldZ)
        const block = (dx + dz) % 2 === 0 ? BlockId.Stone : BlockId.Glass
        this.world.setBlock(worldX, y, worldZ, block)
        this.world.setBlock(worldX, y + 1, worldZ, BlockId.Air)
      }
    }
  }

  private buildGoalTower(side: number, forward: number): void {
    const [worldX, worldZ] = this.courseCell(side, forward)
    const baseY = this.world.getTerrainHeight(worldX, worldZ)

    for (let y = 0; y < 5; y += 1) {
      this.world.setBlock(worldX, baseY + y, worldZ, y % 2 === 0 ? BlockId.Wood : BlockId.Stone)
    }

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        this.world.setBlock(
          worldX + dx,
          baseY + 5,
          worldZ + dz,
          Math.abs(dx) + Math.abs(dz) === 2 ? BlockId.Glass : BlockId.Wood,
        )
      }
    }
  }

  private courseCell(side: number, forward: number): [number, number] {
    return [this.spawnBase.x + side, this.spawnBase.z - forward]
  }

  private courseFloat(side: number, forward: number): [number, number] {
    return [this.spawnBase.x + side, this.spawnBase.z - forward]
  }
}
