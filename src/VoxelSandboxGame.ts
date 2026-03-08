import * as THREE from 'three'
import Stats from 'stats.js'
import { MAX_INTERACTION_DISTANCE, PLAYER_EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './constants'
import { InputController } from './player/InputController'
import { Player } from './player/Player'
import { HOTBAR_BLOCKS, getBlockDefinition, BlockId } from './world/BlockTypes'
import { traceVoxelRay, type VoxelHit } from './world/DDA'
import { World } from './world/World'

export class VoxelSandboxGame {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250)
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  })
  private readonly stats = new Stats()
  private readonly world: World
  private readonly player: Player
  private readonly input: InputController
  private readonly highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03)),
    new THREE.LineBasicMaterial({ color: '#ffd166' }),
  )
  private readonly skyColor = new THREE.Color('#8ecdf9')
  private readonly startCard = document.createElement('div')
  private readonly chunkCounter = document.createElement('span')
  private readonly positionLabel = document.createElement('span')
  private readonly targetLabel = document.createElement('span')
  private readonly lockBadge = document.createElement('span')
  private readonly hotbarButtons: HTMLButtonElement[] = []
  private currentTarget: VoxelHit | null = null
  private selectedSlot = 0
  private disposed = false
  private lastFrameTime = performance.now()

  constructor(private readonly mountNode: HTMLElement) {
    this.mountNode.innerHTML = ''
    this.mountNode.className = 'game-shell'

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.domElement.className = 'game-canvas'
    this.mountNode.append(this.renderer.domElement)

    this.scene.background = this.skyColor
    this.scene.fog = new THREE.Fog(this.skyColor, 60, 165)

    this.setupLights()

    this.world = new World(this.scene)
    this.player = new Player(this.camera, this.renderer.domElement, this.world.getSpawnPoint())
    this.world.primeAround(this.player.position)

    this.input = new InputController(() => this.player.controls.lock())

    this.highlight.visible = false
    this.scene.add(this.highlight)

    this.player.controls.addEventListener('lock', this.syncLockState)
    this.player.controls.addEventListener('unlock', this.syncLockState)
    this.syncLockState()

    this.stats.showPanel(0)
    this.stats.dom.className = 'stats-panel'
    this.mountNode.append(this.stats.dom)

    this.mountNode.append(this.createHud())
    this.updateSelectedSlot(0)
    this.registerDebugHooks()

    window.addEventListener('resize', this.handleResize)
    this.renderer.setAnimationLoop(this.animate)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    window.removeEventListener('resize', this.handleResize)
    this.renderer.setAnimationLoop(null)
    this.input.dispose()
    this.player.controls.removeEventListener('lock', this.syncLockState)
    this.player.controls.removeEventListener('unlock', this.syncLockState)
    this.highlight.geometry.dispose()
    ;(this.highlight.material as THREE.Material).dispose()
    this.world.dispose()
    this.renderer.dispose()
  }

  private readonly animate = (): void => {
    const now = performance.now()
    const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.05)
    this.lastFrameTime = now

    this.stats.begin()
    this.world.update(this.player.position)
    this.player.update(deltaSeconds, this.input, this.world)

    const slotSelection = this.input.consumeSlotSelection()

    if (slotSelection !== null) {
      this.updateSelectedSlot(slotSelection)
    }

    this.updateTarget()
    this.applyBlockEditing()
    this.updateHud()
    this.input.endFrame()
    this.renderer.render(this.scene, this.camera)
    this.stats.end()
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight('#d8f0ff', 0.65)
    const sun = new THREE.DirectionalLight('#fff5de', 1.35)
    sun.position.set(48, 72, 24)
    this.scene.add(ambient, sun)
  }

  private createHud(): HTMLElement {
    const hud = document.createElement('div')
    hud.className = 'hud'

    this.startCard.className = 'start-card'
    this.startCard.innerHTML = `
      <p class="eyebrow">voxel-sandbox-threejs</p>
      <h1>Click To Drop In</h1>
      <p>Pointer Lockで視点を固定。ESCで解除。地形は毎回同じシードで即ロードされます。</p>
      <ul class="controls-list">
        <li>WASD: 移動</li>
        <li>Shift: スニーク</li>
        <li>Space: ジャンプ</li>
        <li>左クリック: 破壊</li>
        <li>右クリック: 設置</li>
        <li>1-5: ブロック切替</li>
      </ul>
    `

    const header = document.createElement('div')
    header.className = 'panel top-left'
    this.lockBadge.className = 'badge'
    this.lockBadge.textContent = 'PAUSED'
    this.chunkCounter.textContent = 'Chunks: 0'
    this.positionLabel.textContent = 'Pos: 0, 0, 0'
    this.targetLabel.textContent = 'Target: none'
    header.append(this.lockBadge, this.chunkCounter, this.positionLabel, this.targetLabel)

    const hotbar = document.createElement('div')
    hotbar.className = 'hotbar'

    HOTBAR_BLOCKS.forEach((block, index) => {
      const definition = getBlockDefinition(block)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'slot'
      button.innerHTML = `<span class="slot-key">${index + 1}</span><span class="slot-name">${definition.label}</span>`
      button.style.setProperty('--slot-color', definition.baseColor)
      button.addEventListener('click', () => this.updateSelectedSlot(index))
      this.hotbarButtons.push(button)
      hotbar.append(button)
    })

    const crosshair = document.createElement('div')
    crosshair.className = 'crosshair'
    crosshair.innerHTML = '<span></span><span></span>'

    hud.append(this.startCard, header, hotbar, crosshair)
    return hud
  }

  private updateTarget(): void {
    this.currentTarget = traceVoxelRay(
      this.camera.position,
      this.player.getLookDirection(),
      MAX_INTERACTION_DISTANCE,
      (x, y, z) => this.world.getBlock(x, y, z),
    )

    if (!this.currentTarget) {
      this.highlight.visible = false
      return
    }

    this.highlight.visible = true
    this.highlight.position.set(
      this.currentTarget.block.x + 0.5,
      this.currentTarget.block.y + 0.5,
      this.currentTarget.block.z + 0.5,
    )
  }

  private applyBlockEditing(): void {
    if (!this.player.isLocked || !this.currentTarget) {
      this.input.consumePrimaryAction()
      this.input.consumeSecondaryAction()
      return
    }

    if (this.input.consumePrimaryAction()) {
      this.world.setBlock(
        this.currentTarget.block.x,
        this.currentTarget.block.y,
        this.currentTarget.block.z,
        BlockId.Air,
      )
    }

    if (this.input.consumeSecondaryAction()) {
      const placePosition = this.currentTarget.adjacent

      if (!this.world.isWithinBuildHeight(placePosition.y)) {
        return
      }

      const nextBlock = HOTBAR_BLOCKS[this.selectedSlot]

      if (this.world.getBlock(placePosition.x, placePosition.y, placePosition.z) !== BlockId.Air) {
        return
      }

      if (this.blockWouldOverlapPlayer(placePosition)) {
        return
      }

      this.world.setBlock(placePosition.x, placePosition.y, placePosition.z, nextBlock)
    }
  }

  private updateHud(): void {
    const position = this.player.position
    this.chunkCounter.textContent = `Chunks: ${this.world.getLoadedChunkCount()}`
    this.positionLabel.textContent = `Pos: ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`
    this.targetLabel.textContent = this.currentTarget
      ? `Target: ${this.currentTarget.block.x}, ${this.currentTarget.block.y}, ${this.currentTarget.block.z}`
      : 'Target: none'
  }

  private updateSelectedSlot(index: number): void {
    this.selectedSlot = index
    this.hotbarButtons.forEach((button, buttonIndex) => {
      button.classList.toggle('active', buttonIndex === index)
    })
  }

  private readonly syncLockState = (): void => {
    const locked = this.player.isLocked
    this.lockBadge.textContent = locked ? 'LOCKED' : 'PAUSED'
    this.startCard.classList.toggle('hidden', locked)
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private registerDebugHooks(): void {
    window.__VOXEL_DEBUG__ = {
      getState: () => ({
        ready: true,
        locked: this.player.isLocked,
        selectedSlot: this.selectedSlot,
        selectedBlock: getBlockDefinition(HOTBAR_BLOCKS[this.selectedSlot]).label,
        loadedChunks: this.world.getLoadedChunkCount(),
        player: {
          x: Number(this.player.position.x.toFixed(3)),
          y: Number(this.player.position.y.toFixed(3)),
          z: Number(this.player.position.z.toFixed(3)),
        },
        target: this.currentTarget
          ? {
              block: this.currentTarget.block.toArray(),
              adjacent: this.currentTarget.adjacent.toArray(),
              distance: Number(this.currentTarget.distance.toFixed(3)),
            }
          : null,
      }),
      peekBlock: (x: number, y: number, z: number) => this.world.getBlock(x, y, z),
    }
  }

  private blockWouldOverlapPlayer(blockPosition: THREE.Vector3): boolean {
    const playerMinX = this.player.position.x - PLAYER_HALF_WIDTH
    const playerMaxX = this.player.position.x + PLAYER_HALF_WIDTH
    const playerMinY = this.player.position.y - PLAYER_EYE_HEIGHT
    const playerMaxY = playerMinY + PLAYER_HEIGHT
    const playerMinZ = this.player.position.z - PLAYER_HALF_WIDTH
    const playerMaxZ = this.player.position.z + PLAYER_HALF_WIDTH

    const blockMinX = blockPosition.x
    const blockMaxX = blockPosition.x + 1
    const blockMinY = blockPosition.y
    const blockMaxY = blockPosition.y + 1
    const blockMinZ = blockPosition.z
    const blockMaxZ = blockPosition.z + 1

    return (
      playerMinX < blockMaxX &&
      playerMaxX > blockMinX &&
      playerMinY < blockMaxY &&
      playerMaxY > blockMinY &&
      playerMinZ < blockMaxZ &&
      playerMaxZ > blockMinZ
    )
  }
}
