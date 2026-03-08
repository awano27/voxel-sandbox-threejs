export class InputController {
  private readonly pressed = new Set<string>()
  private readonly justPressed = new Set<string>()
  private readonly slotQueue: number[] = []
  private primaryActionQueued = false
  private secondaryActionQueued = false

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
