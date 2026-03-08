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
  private mobileIntroDismissed = false

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
    this.mountNode.classList.toggle('touch-mode', this.input.isTouchMode())

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
    const touchMode = this.input.isTouchMode()
    const title = touchMode ? 'Touch To Roam' : 'Click To Drop In'
    const intro = touchMode
      ? '左親指で移動、右親指で視点。JUMP / BREAK / PLACE / SNEAK ボタンでスマホからそのまま遊べます。'
      : 'Pointer Lockで視点を固定。ESCで解除。地形は毎回同じシードで即ロードされます。'
    const controls = touchMode
      ? `
        <li>左スティック: 移動</li>
        <li>右パッド: 視点移動</li>
        <li>JUMP: ジャンプ</li>
        <li>BREAK / PLACE: 破壊 / 設置</li>
        <li>SNEAK: スニーク</li>
      `
      : `
        <li>WASD: 移動</li>
        <li>Shift: スニーク</li>
        <li>Space: ジャンプ</li>
        <li>左クリック: 破壊</li>
        <li>右クリック: 設置</li>
        <li>1-5: ブロック切替</li>
      `

    this.startCard.className = 'start-card'
    this.startCard.innerHTML = `
      <p class="eyebrow">voxel-sandbox-threejs</p>
      <h1>${title}</h1>
      <p>${intro}</p>
      <ul class="controls-list">
        ${controls}
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
      button.id = `slot-${index + 1}`
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

    if (touchMode) {
      hud.append(this.createMobileControls())
    }

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
    if (!this.input.isInteractionEnabled(this.player.isLocked) || !this.currentTarget) {
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
    if (this.input.isTouchMode()) {
      this.lockBadge.textContent = 'TOUCH'
      this.startCard.classList.toggle('hidden', this.mobileIntroDismissed)
      return
    }

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
        touchMode: this.input.isTouchMode(),
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

  private createMobileControls(): HTMLElement {
    const mobileControls = document.createElement('div')
    mobileControls.className = 'mobile-controls'

    const lookZone = document.createElement('div')
    lookZone.id = 'look-zone'
    lookZone.className = 'look-zone'
    lookZone.innerHTML = '<span>LOOK</span>'

    const joystick = document.createElement('div')
    joystick.id = 'move-joystick'
    joystick.className = 'joystick'
    joystick.innerHTML = '<div class="joystick-ring"></div><div class="joystick-thumb"></div>'
    const joystickThumb = joystick.querySelector<HTMLDivElement>('.joystick-thumb')

    if (!joystickThumb) {
      throw new Error('Missing joystick thumb')
    }

    const actions = document.createElement('div')
    actions.className = 'mobile-actions'
    actions.innerHTML = `
      <button id="action-break" class="action-btn action-break" type="button">BREAK</button>
      <button id="action-place" class="action-btn action-place" type="button">PLACE</button>
      <button id="action-jump" class="action-btn action-jump" type="button">JUMP</button>
      <button id="action-sneak" class="action-btn action-sneak" type="button">SNEAK</button>
    `

    this.bindJoystick(joystick, joystickThumb)
    this.bindLookZone(lookZone)
    this.bindTouchActions(actions)

    mobileControls.append(lookZone, joystick, actions)
    return mobileControls
  }

  private bindJoystick(joystick: HTMLDivElement, thumb: HTMLDivElement): void {
    let pointerId: number | null = null

    const resetJoystick = (): void => {
      this.input.setTouchMoveAxes(0, 0)
      thumb.style.transform = 'translate(-50%, -50%)'
      joystick.classList.remove('active')
    }

    const updateStick = (clientX: number, clientY: number): void => {
      const rect = joystick.getBoundingClientRect()
      const radius = rect.width * 0.33
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = clientX - centerX
      const dy = clientY - centerY
      const distance = Math.hypot(dx, dy)
      const scale = distance > radius ? radius / distance : 1
      const clampedX = dx * scale
      const clampedY = dy * scale

      thumb.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`
      this.input.setTouchMoveAxes(clampedX / radius, -clampedY / radius)
    }

    joystick.addEventListener('pointerdown', (event) => {
      this.dismissMobileIntro()
      pointerId = event.pointerId
      joystick.classList.add('active')
      try {
        joystick.setPointerCapture(event.pointerId)
      } catch {}
      updateStick(event.clientX, event.clientY)
    })

    joystick.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) {
        return
      }

      updateStick(event.clientX, event.clientY)
    })

    const releaseStick = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return
      }

      try {
        joystick.releasePointerCapture(event.pointerId)
      } catch {}
      pointerId = null
      resetJoystick()
    }

    joystick.addEventListener('pointerup', releaseStick)
    joystick.addEventListener('pointercancel', releaseStick)
    joystick.addEventListener('lostpointercapture', () => {
      pointerId = null
      resetJoystick()
    })
  }

  private bindLookZone(lookZone: HTMLDivElement): void {
    let pointerId: number | null = null
    let lastX = 0
    let lastY = 0

    lookZone.addEventListener('pointerdown', (event) => {
      this.dismissMobileIntro()
      pointerId = event.pointerId
      lastX = event.clientX
      lastY = event.clientY
      lookZone.classList.add('active')
      try {
        lookZone.setPointerCapture(event.pointerId)
      } catch {}
    })

    lookZone.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) {
        return
      }

      this.input.queueTouchLook(event.clientX - lastX, event.clientY - lastY)
      lastX = event.clientX
      lastY = event.clientY
    })

    const releaseLook = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return
      }

      try {
        lookZone.releasePointerCapture(event.pointerId)
      } catch {}
      pointerId = null
      lookZone.classList.remove('active')
    }

    lookZone.addEventListener('pointerup', releaseLook)
    lookZone.addEventListener('pointercancel', releaseLook)
    lookZone.addEventListener('lostpointercapture', () => {
      pointerId = null
      lookZone.classList.remove('active')
    })
  }

  private bindTouchActions(actions: HTMLDivElement): void {
    const breakButton = actions.querySelector<HTMLButtonElement>('#action-break')
    const placeButton = actions.querySelector<HTMLButtonElement>('#action-place')
    const jumpButton = actions.querySelector<HTMLButtonElement>('#action-jump')
    const sneakButton = actions.querySelector<HTMLButtonElement>('#action-sneak')

    if (!breakButton || !placeButton || !jumpButton || !sneakButton) {
      throw new Error('Missing touch action buttons')
    }

    const tapAction = (button: HTMLButtonElement, handler: () => void): void => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        this.dismissMobileIntro()
        handler()
      })
    }

    tapAction(breakButton, () => this.input.queueTouchPrimaryAction())
    tapAction(placeButton, () => this.input.queueTouchSecondaryAction())
    tapAction(jumpButton, () => this.input.queueTouchJump())

    let sneakPointerId: number | null = null

    sneakButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.dismissMobileIntro()
      sneakPointerId = event.pointerId
      sneakButton.classList.add('active')
      this.input.setTouchSneaking(true)
      try {
        sneakButton.setPointerCapture(event.pointerId)
      } catch {}
    })

    const releaseSneak = (event: PointerEvent): void => {
      if (sneakPointerId !== event.pointerId) {
        return
      }

      sneakPointerId = null
      sneakButton.classList.remove('active')
      this.input.setTouchSneaking(false)
      try {
        sneakButton.releasePointerCapture(event.pointerId)
      } catch {}
    }

    sneakButton.addEventListener('pointerup', releaseSneak)
    sneakButton.addEventListener('pointercancel', releaseSneak)
    sneakButton.addEventListener('lostpointercapture', () => {
      sneakPointerId = null
      sneakButton.classList.remove('active')
      this.input.setTouchSneaking(false)
    })
  }

  private dismissMobileIntro(): void {
    if (!this.input.isTouchMode() || this.mobileIntroDismissed) {
      return
    }

    this.mobileIntroDismissed = true
    this.syncLockState()
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
