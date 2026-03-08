import * as THREE from 'three'
import Stats from 'stats.js'
import { MAX_INTERACTION_DISTANCE, PLAYER_EYE_HEIGHT, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './constants'
import { GameAudio } from './gameplay/GameAudio'
import { Playground, type PlaygroundEvent } from './gameplay/Playground'
import { InputController } from './player/InputController'
import { Player } from './player/Player'
import { HOTBAR_BLOCKS, getBlockDefinition, BlockId } from './world/BlockTypes'
import { traceVoxelRay, type VoxelHit } from './world/DDA'
import { World } from './world/World'

type KidMissionId = 'star' | 'pad' | 'ring' | 'crate' | 'bridge' | 'goal'

interface KidMission {
  id: KidMissionId
  title: string
  hint: string
}

const KID_MISSIONS: KidMission[] = [
  { id: 'star', title: 'Catch a star', hint: 'Grab one of the glowing stars on the path.' },
  { id: 'pad', title: 'Ride the jump pad', hint: 'Step on the orange launch pad and get tossed forward.' },
  { id: 'ring', title: 'Fly through the sky ring', hint: 'Use the jump pad and pass through the blue ring.' },
  { id: 'crate', title: 'Smash the party crate', hint: 'Break the bright crate near the end of the path.' },
  { id: 'bridge', title: 'Build the tiny bridge', hint: 'Place 2 blocks in the glowing bridge slots.' },
  { id: 'goal', title: 'Reach the party orb', hint: 'Finish the course and run to the glowing orb tower.' },
]

export class VoxelSandboxGame {
  private static readonly BEST_RUN_STORAGE_KEY = 'voxel-sandbox-best-run-seconds'
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250)
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  })
  private readonly stats = new Stats()
  private readonly world: World
  private readonly player: Player
  private readonly playground: Playground
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
  private readonly cameraLabel = document.createElement('span')
  private readonly questCard = document.createElement('section')
  private readonly questProgressLabel = document.createElement('p')
  private readonly questList = document.createElement('ol')
  private readonly celebrationToast = document.createElement('div')
  private readonly finishCard = document.createElement('section')
  private readonly hotbar = document.createElement('div')
  private readonly mobileBlockToggle = document.createElement('button')
  private readonly hotbarButtons: HTMLButtonElement[] = []
  private readonly completedMissions = new Set<KidMissionId>()
  private readonly audio = new GameAudio()
  private currentTarget: VoxelHit | null = null
  private selectedSlot = 0
  private disposed = false
  private lastFrameTime = performance.now()
  private mobileIntroDismissed = false
  private mobileHotbarExpanded = false
  private celebrationTimer = 0
  private runSeconds = 0
  private courseFinished = false
  private finishCardDismissed = false
  private bestRunSeconds = Number.POSITIVE_INFINITY

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
    this.playground = new Playground(this.scene, this.world, this.player.position)
    this.scene.add(this.player.avatar.root)

    this.input = new InputController(() => this.player.controls.lock())
    this.mountNode.classList.toggle('touch-mode', this.input.isTouchMode())
    this.bestRunSeconds = this.readBestRunSeconds()

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
    this.audio.dispose()
    this.player.avatar.dispose()
    this.playground.dispose()
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

    if (this.input.consumeCameraToggle()) {
      this.player.toggleCameraMode()
    }

    this.handlePlaygroundEvents(this.playground.update(deltaSeconds, this.player, now / 1000))
    this.trackTimers(deltaSeconds)
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
    const title = touchMode ? 'Treasure Run Starts Here' : 'Click Into Treasure Run'
    const intro = touchMode
      ? 'Grab stars, fly through the ring, smash the crate, build a mini bridge, and finish at the orb.'
      : 'Start with a mini obstacle run: collect stars, launch through the ring, smash the crate, build a tiny bridge, and sprint for the orb.'
    const controls = touchMode
      ? `
        <li>Left stick: Move</li>
        <li>LOOK zone: Turn the camera</li>
        <li>JUMP: Hop or fly from the launch pad</li>
        <li>BREAK / PLACE: Smash and build</li>
        <li>SNEAK / CAM: Slow walk / switch camera</li>
      `
      : `
        <li>WASD: Move</li>
        <li>Shift: Sneak</li>
        <li>Space: Jump</li>
        <li>Left click / Right click: Break / place</li>
        <li>1-5: Change block</li>
        <li>V: Switch camera</li>
      `

    this.startCard.className = 'start-card'
    this.startCard.innerHTML = touchMode
      ? `
        <p class="eyebrow">voxel-sandbox-threejs</p>
        <h1>${title}</h1>
        <p>${intro}</p>
        <ol class="quick-start-list">
          <li>Follow the stars</li>
          <li>Fly through the ring</li>
          <li>Smash the crate and build the bridge</li>
        </ol>
      `
      : `
        <p class="eyebrow">voxel-sandbox-threejs</p>
        <h1>${title}</h1>
        <p>${intro}</p>
        <div class="howto-grid">
          <section class="howto-card">
            <h2>First 30 Seconds</h2>
            <ol class="howto-steps">
              <li>Click to lock in, then follow the stars.</li>
              <li>Use the jump pad to fly through the sky ring.</li>
              <li>Smash the crate, build the mini bridge, and sprint to the orb.</li>
            </ol>
          </section>
          <section class="howto-card">
            <h2>What Is New</h2>
            <ul class="feature-list">
              <li>A toy-course now runs straight out from spawn.</li>
              <li>The launch pad and sky ring make the first jump feel like a stunt.</li>
              <li>Press V to watch your hero in third person.</li>
            </ul>
          </section>
        </div>
        <p class="helper-copy">
          Tip: the Quest Board always shows one clear thing to try next, so kids do not need to guess what to do.
        </p>
        <ul class="controls-list">
          ${controls}
        </ul>
      `
    this.startCard.append(this.createStartActions(touchMode))

    if (!touchMode) {
      this.startCard.addEventListener('click', () => {
        if (this.player.isLocked) {
          return
        }

        this.audio.unlock()
        this.player.controls.lock()
      })
    }

    const header = document.createElement('div')
    header.className = 'panel top-left'
    this.lockBadge.className = 'badge'
    this.lockBadge.textContent = 'PAUSED'
    this.cameraLabel.className = 'camera-chip'
    this.cameraLabel.textContent = 'THIRD PERSON'
    this.chunkCounter.className = 'status-detail'
    this.chunkCounter.textContent = 'Chunks: 0'
    this.positionLabel.className = 'status-detail'
    this.positionLabel.textContent = 'Pos: 0, 0, 0'
    this.targetLabel.className = 'status-detail'
    this.targetLabel.textContent = 'Target: none'
    header.append(this.lockBadge, this.cameraLabel, this.chunkCounter, this.positionLabel, this.targetLabel)

    this.hotbar.className = 'hotbar'

    HOTBAR_BLOCKS.forEach((block, index) => {
      const definition = getBlockDefinition(block)
      const button = document.createElement('button')
      button.type = 'button'
      button.id = `slot-${index + 1}`
      button.className = 'slot'
      button.innerHTML = `<span class="slot-key">${index + 1}</span><span class="slot-name">${definition.label}</span>`
      button.style.setProperty('--slot-color', definition.baseColor)
      button.addEventListener('click', () => {
        this.updateSelectedSlot(index)
        if (this.input.isTouchMode()) {
          this.setMobileHotbarExpanded(false)
        }
      })
      this.hotbarButtons.push(button)
      this.hotbar.append(button)
    })

    const crosshair = document.createElement('div')
    crosshair.className = 'crosshair'
    crosshair.innerHTML = '<span></span><span></span>'

    hud.append(
      this.startCard,
      header,
      this.createQuestHud(),
      this.createCelebrationToast(),
      this.createFinishCard(),
      this.hotbar,
      crosshair,
    )

    if (touchMode) {
      hud.append(this.createMobileControls())
    }

    return hud
  }

  private createStartActions(touchMode: boolean): HTMLElement {
    const actions = document.createElement('div')
    actions.className = 'start-actions'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'start-button'
    button.textContent = touchMode ? 'START PLAYING' : 'CLICK TO PLAY'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      this.audio.unlock()

      if (touchMode) {
        this.dismissMobileIntro()
        return
      }

      this.player.controls.lock()
    })

    const note = document.createElement('p')
    note.className = 'start-note'
    note.textContent = touchMode
      ? 'Tap once to begin. Move with the left stick, look on the right, and follow the course in order.'
      : 'Click once to begin. The whole obstacle course starts right ahead of spawn.'

    actions.append(button, note)
    return actions
  }

  private createQuestHud(): HTMLElement {
    this.questCard.className = 'panel quest-card'
    this.questCard.innerHTML = '<p class="quest-eyebrow">KIDS MODE</p><h2>Quest Board</h2>'
    this.questProgressLabel.className = 'quest-progress'
    this.questList.className = 'quest-list'
    this.questCard.append(this.questProgressLabel, this.questList)
    this.renderQuestHud()
    return this.questCard
  }

  private createCelebrationToast(): HTMLElement {
    this.celebrationToast.className = 'celebration-toast'
    this.celebrationToast.setAttribute('aria-live', 'polite')
    return this.celebrationToast
  }

  private createFinishCard(): HTMLElement {
    this.finishCard.className = 'finish-card'
    this.finishCard.setAttribute('aria-live', 'polite')
    this.finishCard.innerHTML = `
      <p class="eyebrow">course clear</p>
      <h2>Treasure Run Complete</h2>
      <p class="finish-copy">You hit the orb and unlocked free build mode.</p>
      <div class="finish-stats">
        <article>
          <span>Run Time</span>
          <strong id="finish-run-time">--</strong>
        </article>
        <article>
          <span>Best Time</span>
          <strong id="finish-best-time">--</strong>
        </article>
      </div>
      <div class="finish-actions">
        <button id="finish-restart" class="start-button" type="button">PLAY AGAIN</button>
        <button id="finish-continue" class="ghost-button" type="button">KEEP BUILDING</button>
      </div>
    `

    const restartButton = this.finishCard.querySelector<HTMLButtonElement>('#finish-restart')
    const continueButton = this.finishCard.querySelector<HTMLButtonElement>('#finish-continue')

    restartButton?.addEventListener('click', () => {
      window.location.reload()
    })

    continueButton?.addEventListener('click', () => {
      this.finishCardDismissed = true
      this.finishCard.classList.remove('visible')
      this.showCelebration('Free build mode')

      if (!this.input.isTouchMode() && !this.player.isLocked) {
        this.audio.unlock()
        this.player.controls.lock()
      }
    })

    return this.finishCard
  }

  private updateTarget(): void {
    this.currentTarget = traceVoxelRay(
      this.player.getInteractionOrigin(),
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
      this.audio.play('place')
    }
  }

  private updateHud(): void {
    const position = this.player.position
    const playgroundState = this.playground.getState()
    this.cameraLabel.textContent = this.player.currentCameraMode === 'third-person' ? 'THIRD PERSON' : 'FIRST PERSON'
    this.chunkCounter.textContent = `Chunks: ${this.world.getLoadedChunkCount()}`
    this.positionLabel.textContent = `Pos: ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`
    this.targetLabel.textContent = this.currentTarget
      ? `Target: ${this.currentTarget.block.x}, ${this.currentTarget.block.y}, ${this.currentTarget.block.z} | Stars ${playgroundState.starsCollected}/${playgroundState.starsTotal} | Bridge ${playgroundState.bridgePlaced}/${playgroundState.bridgeNeeded}`
      : `Target: none | Stars ${playgroundState.starsCollected}/${playgroundState.starsTotal} | Bridge ${playgroundState.bridgePlaced}/${playgroundState.bridgeNeeded}`
    this.renderQuestHud()
    this.updateCelebrationToast()
    this.finishCard.classList.toggle('visible', this.courseFinished && !this.finishCardDismissed)
  }

  private updateSelectedSlot(index: number): void {
    this.selectedSlot = index
    this.hotbarButtons.forEach((button, buttonIndex) => {
      button.classList.toggle('active', buttonIndex === index)
    })
    this.refreshMobileBlockToggle()
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

  private trackTimers(deltaSeconds: number): void {
    if (this.celebrationTimer > 0) {
      this.celebrationTimer = Math.max(0, this.celebrationTimer - deltaSeconds)
    }

    if (!this.courseFinished && this.isRunActive()) {
      this.runSeconds += deltaSeconds
    }
  }

  private handlePlaygroundEvents(events: PlaygroundEvent[]): void {
    for (const event of events) {
      if (event.type === 'star-collected') {
        this.audio.play('star')
        const firstStar = !this.completedMissions.has('star')
        this.completeMission('star')

        if (!firstStar) {
          this.showCelebration(`Stars ${event.collected}/${event.total}`)
        }
      }

      if (event.type === 'all-stars-collected') {
        this.showCelebration('All stars collected')
      }

      if (event.type === 'pad-used') {
        this.audio.play('boost')
        this.completeMission('pad')
      }

      if (event.type === 'ring-cleared') {
        this.audio.play('ring')
        this.completeMission('ring')
      }

      if (event.type === 'crate-smashed') {
        this.audio.play('smash')
        this.completeMission('crate')
      }

      if (event.type === 'bridge-progress') {
        this.showCelebration(`Bridge ${event.placed}/${event.total}`)
      }

      if (event.type === 'bridge-complete') {
        this.audio.play('bridge')
        this.completeMission('bridge')
      }

      if (event.type === 'goal-reached') {
        this.completeMission('goal')
        this.handleCourseFinished()
      }
    }
  }

  private completeMission(id: KidMissionId): void {
    if (this.completedMissions.has(id)) {
      return
    }

    this.completedMissions.add(id)
    const mission = KID_MISSIONS.find((entry) => entry.id === id)

    if (mission) {
      this.showCelebration(`Quest clear: ${mission.title}`)
    }

    if (this.completedMissions.size === KID_MISSIONS.length) {
      this.showCelebration('Sandbox Star unlocked')
      this.questCard.classList.add('all-clear')
    }

    this.renderQuestHud()
  }

  private renderQuestHud(): void {
    const completeCount = this.completedMissions.size
    const playgroundState = this.playground.getState()
    const compactMode = this.input.isTouchMode()
    const nextMission = KID_MISSIONS.find((mission) => !this.completedMissions.has(mission.id))
    const missionsToRender = compactMode
      ? nextMission
        ? [nextMission]
        : [KID_MISSIONS[KID_MISSIONS.length - 1]]
      : KID_MISSIONS

    this.questCard.classList.toggle('all-clear', completeCount === KID_MISSIONS.length)
    this.questCard.classList.toggle('compact', compactMode)
    this.questProgressLabel.textContent =
      completeCount === KID_MISSIONS.length
        ? compactMode
          ? `All clear | ${this.formatSeconds(this.runSeconds)}`
          : `All starter quests cleared in ${this.formatSeconds(this.runSeconds)}. Free build unlocked.`
        : compactMode
          ? `Next up | ${this.formatSeconds(this.runSeconds)} | Stars ${playgroundState.starsCollected}/${playgroundState.starsTotal}`
          : `${completeCount}/${KID_MISSIONS.length} starter quests cleared | Time ${this.formatSeconds(this.runSeconds)} | Best ${this.formatBestTime()}`

    this.questList.innerHTML = missionsToRender.map((mission) => {
      const done = this.completedMissions.has(mission.id)
      return `
        <li class="${done ? 'done' : ''}">
          <span class="quest-mark">${done ? 'DONE' : 'NEXT'}</span>
          <div>
            <strong>${mission.title}</strong>
            <p>${mission.hint}</p>
          </div>
        </li>
      `
    }).join('')
  }

  private showCelebration(message: string): void {
    this.celebrationToast.textContent = message
    this.celebrationToast.classList.add('visible')
    this.celebrationTimer = 2.4
  }

  private updateCelebrationToast(): void {
    this.celebrationToast.classList.toggle('visible', this.celebrationTimer > 0)
  }

  private registerDebugHooks(): void {
    window.__VOXEL_DEBUG__ = {
      getState: () => ({
        ready: true,
        locked: this.player.isLocked,
        touchMode: this.input.isTouchMode(),
        cameraMode: this.player.currentCameraMode,
        selectedSlot: this.selectedSlot,
        selectedBlock: getBlockDefinition(HOTBAR_BLOCKS[this.selectedSlot]).label,
        loadedChunks: this.world.getLoadedChunkCount(),
        missionsComplete: this.completedMissions.size,
        missionsTotal: KID_MISSIONS.length,
        runSeconds: Number(this.runSeconds.toFixed(3)),
        bestRunSeconds: Number.isFinite(this.bestRunSeconds) ? Number(this.bestRunSeconds.toFixed(3)) : null,
        courseFinished: this.courseFinished,
        playground: this.playground.getState(),
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
      <button id="action-camera" class="action-btn action-camera" type="button">CAM</button>
    `
    this.mobileBlockToggle.type = 'button'
    this.mobileBlockToggle.id = 'mobile-block-toggle'
    this.mobileBlockToggle.className = 'mobile-block-toggle'
    this.mobileBlockToggle.addEventListener('click', () => {
      this.setMobileHotbarExpanded(!this.mobileHotbarExpanded)
    })
    this.refreshMobileBlockToggle()

    this.bindJoystick(joystick, joystickThumb)
    this.bindLookZone(lookZone)
    this.bindTouchActions(actions)

    mobileControls.append(lookZone, joystick, this.mobileBlockToggle, actions)
    return mobileControls
  }

  private setMobileHotbarExpanded(expanded: boolean): void {
    this.mobileHotbarExpanded = expanded
    this.hotbar.classList.toggle('expanded', expanded)
    this.refreshMobileBlockToggle()
  }

  private refreshMobileBlockToggle(): void {
    if (!this.input.isTouchMode()) {
      return
    }

    const selectedBlock = getBlockDefinition(HOTBAR_BLOCKS[this.selectedSlot]).label
    this.mobileBlockToggle.textContent = this.mobileHotbarExpanded ? `HIDE BLOCKS` : `BLOCKS: ${selectedBlock}`
    this.mobileBlockToggle.classList.toggle('active', this.mobileHotbarExpanded)
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
    const cameraButton = actions.querySelector<HTMLButtonElement>('#action-camera')

    if (!breakButton || !placeButton || !jumpButton || !sneakButton || !cameraButton) {
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
    tapAction(cameraButton, () => this.input.queueTouchCameraToggle())

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

    this.audio.unlock()
    this.mobileIntroDismissed = true
    this.syncLockState()
  }

  private isRunActive(): boolean {
    return this.input.isTouchMode() ? this.mobileIntroDismissed : this.player.isLocked
  }

  private handleCourseFinished(): void {
    if (this.courseFinished) {
      return
    }

    this.courseFinished = true
    this.finishCardDismissed = false
    this.audio.play('victory')
    this.bestRunSeconds = Math.min(this.bestRunSeconds, this.runSeconds)
    this.persistBestRunSeconds(this.bestRunSeconds)
    this.updateFinishCard()

    if (!this.input.isTouchMode() && this.player.isLocked) {
      this.player.controls.unlock()
    }
  }

  private updateFinishCard(): void {
    const runTime = this.finishCard.querySelector<HTMLElement>('#finish-run-time')
    const bestTime = this.finishCard.querySelector<HTMLElement>('#finish-best-time')

    if (runTime) {
      runTime.textContent = this.formatSeconds(this.runSeconds)
    }

    if (bestTime) {
      bestTime.textContent = this.formatBestTime()
    }
  }

  private readBestRunSeconds(): number {
    try {
      const storedValue = window.localStorage.getItem(VoxelSandboxGame.BEST_RUN_STORAGE_KEY)

      if (!storedValue) {
        return Number.POSITIVE_INFINITY
      }

      const numericValue = Number(storedValue)
      return Number.isFinite(numericValue) ? numericValue : Number.POSITIVE_INFINITY
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  private persistBestRunSeconds(value: number): void {
    try {
      window.localStorage.setItem(VoxelSandboxGame.BEST_RUN_STORAGE_KEY, value.toFixed(3))
    } catch {}
  }

  private formatSeconds(value: number): string {
    return `${value.toFixed(1)}s`
  }

  private formatBestTime(): string {
    return Number.isFinite(this.bestRunSeconds) ? this.formatSeconds(this.bestRunSeconds) : 'new run'
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
