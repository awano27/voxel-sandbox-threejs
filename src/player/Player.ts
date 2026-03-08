import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import {
  PLAYER_AIR_CONTROL,
  PLAYER_EYE_HEIGHT,
  PLAYER_GRAVITY,
  PLAYER_GROUND_ACCELERATION,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_SNEAK_SPEED,
  PLAYER_SPEED,
} from '../constants'
import type { World } from '../world/World'
import type { InputController } from './InputController'
import { PlayerAvatar } from './PlayerAvatar'

export type CameraMode = 'first-person' | 'third-person'

export class Player {
  readonly controls: PointerLockControls
  readonly avatar = new PlayerAvatar()
  readonly velocity = new THREE.Vector3()
  readonly cameraDirection = new THREE.Vector3()
  private readonly bodyPosition: THREE.Vector3
  private grounded = false
  private readonly lookEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  private cameraMode: CameraMode = 'third-person'
  private readonly thirdPersonOffset = new THREE.Vector3(0, 1.28, 3.55)
  private readonly thirdPersonCameraPosition = new THREE.Vector3()

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    spawnPoint: THREE.Vector3,
  ) {
    this.controls = new PointerLockControls(this.camera, domElement)
    this.bodyPosition = spawnPoint.clone()
    this.camera.rotation.x = -0.24
    this.lookEuler.copy(this.camera.rotation)
    this.updateCameraTransform()
  }

  get position(): THREE.Vector3 {
    return this.bodyPosition
  }

  get isLocked(): boolean {
    return this.controls.isLocked
  }

  get currentCameraMode(): CameraMode {
    return this.cameraMode
  }

  get isGrounded(): boolean {
    return this.grounded
  }

  update(deltaSeconds: number, input: InputController, world: World): void {
    const moveDirection = new THREE.Vector3()
    const lookDelta = input.consumeLookDelta()
    const forward = this.getForwardVector()
    const right = new THREE.Vector3(-forward.z, 0, forward.x)
    const moveAxes = input.getMoveAxes()

    if (lookDelta.x !== 0 || lookDelta.y !== 0) {
      this.applyLookDelta(lookDelta.x, lookDelta.y)
      forward.copy(this.getForwardVector())
      right.set(-forward.z, 0, forward.x)
    }

    if (moveAxes.forward !== 0) moveDirection.addScaledVector(forward, moveAxes.forward)
    if (moveAxes.strafe !== 0) moveDirection.addScaledVector(right, moveAxes.strafe)

    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize()
    }

    const speed = input.isSneaking() ? PLAYER_SNEAK_SPEED : PLAYER_SPEED
    const control = this.grounded ? 1 : PLAYER_AIR_CONTROL
    const acceleration = PLAYER_GROUND_ACCELERATION * control

    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, moveDirection.x * speed, acceleration, deltaSeconds)
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, moveDirection.z * speed, acceleration, deltaSeconds)
    this.velocity.y -= PLAYER_GRAVITY * deltaSeconds

    if (this.grounded && input.consumeJump()) {
      this.velocity.y = PLAYER_JUMP_SPEED
      this.grounded = false
    }

    this.moveWithCollisions(world, this.velocity.x * deltaSeconds, 'x')
    this.moveWithCollisions(world, this.velocity.z * deltaSeconds, 'z')
    this.moveWithCollisions(world, this.velocity.y * deltaSeconds, 'y')
    this.updateCameraTransform()
    this.updateAvatar(deltaSeconds)
  }

  getLookDirection(): THREE.Vector3 {
    return this.camera.getWorldDirection(this.cameraDirection).normalize()
  }

  getInteractionOrigin(): THREE.Vector3 {
    if (this.cameraMode === 'third-person') {
      return this.bodyPosition
    }

    return this.camera.position
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode
    this.updateCameraTransform()
    this.updateAvatar(0)
  }

  toggleCameraMode(): void {
    this.setCameraMode(this.cameraMode === 'first-person' ? 'third-person' : 'first-person')
  }

  private applyLookDelta(deltaX: number, deltaY: number): void {
    this.lookEuler.setFromQuaternion(this.camera.quaternion)
    this.lookEuler.y -= deltaX * 0.0034
    this.lookEuler.x -= deltaY * 0.0034
    this.lookEuler.x = THREE.MathUtils.clamp(this.lookEuler.x, -Math.PI / 2 + 0.08, Math.PI / 2 - 0.08)
    this.camera.quaternion.setFromEuler(this.lookEuler)
  }

  private getForwardVector(): THREE.Vector3 {
    const forward = this.getLookDirection()
    forward.y = 0
    return forward.normalize()
  }

  private moveWithCollisions(world: World, amount: number, axis: 'x' | 'y' | 'z'): void {
    if (amount === 0) {
      return
    }

    const position = this.bodyPosition.clone()
    position[axis] += amount
    const aabb = createAabb(position)

    const minX = Math.floor(aabb.min.x)
    const maxX = Math.floor(aabb.max.x - 0.0001)
    const minY = Math.floor(aabb.min.y)
    const maxY = Math.floor(aabb.max.y - 0.0001)
    const minZ = Math.floor(aabb.min.z)
    const maxZ = Math.floor(aabb.max.z - 0.0001)

    let collided = false

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (!world.isSolidAt(x, y, z)) {
            continue
          }

          collided = true

          if (axis === 'x') {
            position.x = amount > 0 ? Math.min(position.x, x - PLAYER_HALF_WIDTH) : Math.max(position.x, x + 1 + PLAYER_HALF_WIDTH)
          }

          if (axis === 'z') {
            position.z = amount > 0 ? Math.min(position.z, z - PLAYER_HALF_WIDTH) : Math.max(position.z, z + 1 + PLAYER_HALF_WIDTH)
          }

          if (axis === 'y') {
            const feetHeight = PLAYER_HEIGHT - PLAYER_EYE_HEIGHT
            position.y = amount > 0 ? Math.min(position.y, y - feetHeight) : Math.max(position.y, y + 1 + PLAYER_EYE_HEIGHT)
          }
        }
      }
    }

    this.bodyPosition[axis] = position[axis]

    if (collided && axis === 'y') {
      if (amount < 0) {
        this.grounded = true
      }

      this.velocity.y = 0
    } else if (axis === 'y') {
      this.grounded = false
    }
  }

  private updateCameraTransform(): void {
    if (this.cameraMode === 'first-person') {
      this.camera.position.copy(this.bodyPosition)
      return
    }

    this.thirdPersonCameraPosition.copy(this.thirdPersonOffset).applyQuaternion(this.camera.quaternion)
    this.camera.position.copy(this.bodyPosition).add(this.thirdPersonCameraPosition)
  }

  private updateAvatar(deltaSeconds: number): void {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z)
    const desiredYaw =
      horizontalSpeed > 0.08
        ? Math.atan2(this.velocity.x, this.velocity.z)
        : Math.atan2(this.getLookDirection().x, this.getLookDirection().z)

    this.avatar.update({
      position: this.bodyPosition,
      facingYaw: desiredYaw,
      horizontalSpeed,
      verticalVelocity: this.velocity.y,
      grounded: this.grounded,
      visible: this.cameraMode === 'third-person',
      deltaSeconds,
    })
  }
}

function createAabb(position: THREE.Vector3): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(
      position.x - PLAYER_HALF_WIDTH,
      position.y - PLAYER_EYE_HEIGHT,
      position.z - PLAYER_HALF_WIDTH,
    ),
    new THREE.Vector3(
      position.x + PLAYER_HALF_WIDTH,
      position.y - PLAYER_EYE_HEIGHT + PLAYER_HEIGHT,
      position.z + PLAYER_HALF_WIDTH,
    ),
  )
}
