export class InputController {
  private readonly pressed = new Set<string>()
  private readonly justPressed = new Set<string>()
  private readonly slotQueue: number[] = []
  private primaryActionQueued = false
  private secondaryActionQueued = false
  private readonly touchMode = isTouchUiPreferred()
  private touchMoveAxes = { strafe: 0, forward: 0 }
  private touchLookDelta = { x: 0, y: 0 }
  private touchSneaking = false

  constructor(private readonly lockPointer: () => void) {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    window.addEventListener('mousedown', this.handleMouseDown)
    window.addEventListener('contextmenu', this.handleContextMenu)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    window.removeEventListener('mousedown', this.handleMouseDown)
    window.removeEventListener('contextmenu', this.handleContextMenu)
  }

  isPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  isTouchMode(): boolean {
    return this.touchMode
  }

  isInteractionEnabled(pointerLocked: boolean): boolean {
    return pointerLocked || this.touchMode
  }

  isSneaking(): boolean {
    return this.pressed.has('ShiftLeft') || this.touchSneaking
  }

  getMoveAxes(): { strafe: number; forward: number } {
    let strafe = 0
    let forward = 0

    if (this.pressed.has('KeyD')) strafe += 1
    if (this.pressed.has('KeyA')) strafe -= 1
    if (this.pressed.has('KeyW')) forward += 1
    if (this.pressed.has('KeyS')) forward -= 1

    strafe += this.touchMoveAxes.strafe
    forward += this.touchMoveAxes.forward

    const length = Math.hypot(strafe, forward)

    if (length > 1) {
      strafe /= length
      forward /= length
    }

    return { strafe, forward }
  }

  consumeLookDelta(): { x: number; y: number } {
    const delta = { ...this.touchLookDelta }
    this.touchLookDelta.x = 0
    this.touchLookDelta.y = 0
    return delta
  }

  consumeJump(): boolean {
    return this.consumeKey('Space')
  }

  consumeSlotSelection(): number | null {
    return this.slotQueue.shift() ?? null
  }

  consumePrimaryAction(): boolean {
    const queued = this.primaryActionQueued
    this.primaryActionQueued = false
    return queued
  }

  consumeSecondaryAction(): boolean {
    const queued = this.secondaryActionQueued
    this.secondaryActionQueued = false
    return queued
  }

  setTouchMoveAxes(strafe: number, forward: number): void {
    this.touchMoveAxes.strafe = strafe
    this.touchMoveAxes.forward = forward
  }

  queueTouchLook(deltaX: number, deltaY: number): void {
    this.touchLookDelta.x += deltaX
    this.touchLookDelta.y += deltaY
  }

  queueTouchJump(): void {
    this.justPressed.add('Space')
  }

  queueTouchPrimaryAction(): void {
    this.primaryActionQueued = true
  }

  queueTouchSecondaryAction(): void {
    this.secondaryActionQueued = true
  }

  setTouchSneaking(active: boolean): void {
    this.touchSneaking = active
  }

  endFrame(): void {
    this.justPressed.clear()
  }

  private consumeKey(code: string): boolean {
    const exists = this.justPressed.has(code)
    this.justPressed.delete(code)
    return exists
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return
    }

    this.pressed.add(event.code)
    this.justPressed.add(event.code)

    const digit = Number.parseInt(event.key, 10)

    if (digit >= 1 && digit <= 5) {
      this.slotQueue.push(digit - 1)
    }
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code)
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (this.touchMode) {
      return
    }

    if (document.pointerLockElement === null) {
      this.lockPointer()
      return
    }

    if (event.button === 0) {
      this.primaryActionQueued = true
    }

    if (event.button === 2) {
      this.secondaryActionQueued = true
    }
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }
}

function isTouchUiPreferred(): boolean {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const finePointer = window.matchMedia('(pointer: fine)').matches

  if (coarsePointer) {
    return true
  }

  if (finePointer) {
    return false
  }

  return window.innerWidth <= 900 && navigator.maxTouchPoints > 0
}
