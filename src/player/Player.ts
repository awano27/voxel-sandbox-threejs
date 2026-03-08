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

export class Player {
  readonly controls: PointerLockControls
  readonly velocity = new THREE.Vector3()
  readonly cameraDirection = new THREE.Vector3()
  private grounded = false

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    spawnPoint: THREE.Vector3,
  ) {
    this.controls = new PointerLockControls(this.camera, domElement)
    this.camera.position.copy(spawnPoint)
    this.camera.rotation.x = -0.24
  }

  get position(): THREE.Vector3 {
    return this.camera.position
  }

  get isLocked(): boolean {
    return this.controls.isLocked
  }

  update(deltaSeconds: number, input: InputController, world: World): void {
    const moveDirection = new THREE.Vector3()
    const forward = this.getForwardVector()
    const right = new THREE.Vector3(-forward.z, 0, forward.x)

    if (input.isPressed('KeyW')) moveDirection.add(forward)
    if (input.isPressed('KeyS')) moveDirection.sub(forward)
    if (input.isPressed('KeyD')) moveDirection.add(right)
    if (input.isPressed('KeyA')) moveDirection.sub(right)

    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize()
    }

    const speed = input.isPressed('ShiftLeft') ? PLAYER_SNEAK_SPEED : PLAYER_SPEED
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
  }

  getLookDirection(): THREE.Vector3 {
    return this.camera.getWorldDirection(this.cameraDirection).normalize()
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

    const position = this.camera.position.clone()
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

    this.camera.position[axis] = position[axis]

    if (collided && axis === 'y') {
      if (amount < 0) {
        this.grounded = true
      }

      this.velocity.y = 0
    } else if (axis === 'y') {
      this.grounded = false
    }
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
