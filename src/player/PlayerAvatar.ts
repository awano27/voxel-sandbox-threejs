import * as THREE from 'three'

export interface AvatarState {
  position: THREE.Vector3
  facingYaw: number
  horizontalSpeed: number
  verticalVelocity: number
  grounded: boolean
  visible: boolean
  deltaSeconds: number
}

export class PlayerAvatar {
  readonly root = new THREE.Group()
  private readonly headPivot = new THREE.Group()
  private readonly leftArmPivot = new THREE.Group()
  private readonly rightArmPivot = new THREE.Group()
  private readonly leftLegPivot = new THREE.Group()
  private readonly rightLegPivot = new THREE.Group()
  private readonly bodyMaterial = new THREE.MeshLambertMaterial({ color: '#2d74ff' })
  private readonly accentMaterial = new THREE.MeshLambertMaterial({ color: '#f6d365' })
  private readonly skinMaterial = new THREE.MeshLambertMaterial({ color: '#ffd7b1' })
  private walkTime = 0
  private visualYaw = 0

  constructor() {
    this.root.name = 'player-avatar'

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.78, 0.34), this.bodyMaterial)
    torso.position.y = 1.08

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.38, 0.3), this.accentMaterial)
    hips.position.y = 0.52

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), this.skinMaterial)
    this.headPivot.position.y = 1.62
    head.position.y = 0.24
    this.headPivot.add(head)

    this.leftArmPivot.position.set(-0.48, 1.33, 0)
    this.rightArmPivot.position.set(0.48, 1.33, 0)
    this.leftLegPivot.position.set(-0.18, 0.71, 0)
    this.rightLegPivot.position.set(0.18, 0.71, 0)

    this.leftArmPivot.add(this.createLimb(this.bodyMaterial, 0.24, 0.72, 0.24))
    this.rightArmPivot.add(this.createLimb(this.bodyMaterial, 0.24, 0.72, 0.24))
    this.leftLegPivot.add(this.createLimb(this.accentMaterial, 0.24, 0.78, 0.24))
    this.rightLegPivot.add(this.createLimb(this.accentMaterial, 0.24, 0.78, 0.24))

    this.root.add(
      torso,
      hips,
      this.headPivot,
      this.leftArmPivot,
      this.rightArmPivot,
      this.leftLegPivot,
      this.rightLegPivot,
    )
  }

  update(state: AvatarState): void {
    this.root.visible = state.visible

    if (!state.visible) {
      return
    }

    this.root.position.set(state.position.x, state.position.y - 1.62, state.position.z)

    const desiredYaw = state.horizontalSpeed > 0.08 ? state.facingYaw : this.visualYaw
    this.visualYaw = dampAngle(this.visualYaw, desiredYaw, 10, state.deltaSeconds)
    this.root.rotation.y = this.visualYaw

    const runStrength = THREE.MathUtils.clamp(state.horizontalSpeed / 4.6, 0, 1)

    if (state.grounded) {
      this.walkTime += state.deltaSeconds * (5 + runStrength * 9)
    } else {
      this.walkTime += state.deltaSeconds * 4
    }

    const swing = Math.sin(this.walkTime) * (0.22 + runStrength * 0.45)
    const counterSwing = Math.sin(this.walkTime + Math.PI) * (0.22 + runStrength * 0.45)
    const lift = state.grounded ? 0 : THREE.MathUtils.clamp(-state.verticalVelocity * 0.03, -0.22, 0.32)
    const airborneTilt = state.grounded ? 0 : THREE.MathUtils.clamp(state.verticalVelocity * 0.035, -0.24, 0.2)

    this.leftArmPivot.rotation.x = swing - lift * 0.4
    this.rightArmPivot.rotation.x = counterSwing - lift * 0.4
    this.leftLegPivot.rotation.x = counterSwing + lift
    this.rightLegPivot.rotation.x = swing + lift
    this.headPivot.rotation.x = airborneTilt * 0.35
  }

  dispose(): void {
    this.bodyMaterial.dispose()
    this.accentMaterial.dispose()
    this.skinMaterial.dispose()
  }

  private createLimb(material: THREE.Material, width: number, height: number, depth: number): THREE.Mesh {
    const limb = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
    limb.position.y = -height / 2
    return limb
  }
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  const deltaAngle = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI
  return current + deltaAngle * (1 - Math.exp(-lambda * delta))
}
