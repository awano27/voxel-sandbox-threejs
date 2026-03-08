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
  private readonly shadow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.52, 0.04, 18),
    new THREE.MeshLambertMaterial({ color: '#1f2d16', transparent: true, opacity: 0.34 }),
  )
  private readonly torsoMaterial = new THREE.MeshLambertMaterial({ color: '#2f7df6' })
  private readonly sleeveMaterial = new THREE.MeshLambertMaterial({ color: '#1f5ec7' })
  private readonly pantsMaterial = new THREE.MeshLambertMaterial({ color: '#2b3648' })
  private readonly shoeMaterial = new THREE.MeshLambertMaterial({ color: '#1a1d24' })
  private readonly skinMaterial = new THREE.MeshLambertMaterial({ color: '#ffd7b1' })
  private readonly hairMaterial = new THREE.MeshLambertMaterial({ color: '#3c2617' })
  private walkTime = 0
  private visualYaw = 0

  constructor() {
    this.root.name = 'player-avatar'

    this.shadow.position.y = 0.02

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.96, 0.46), this.torsoMaterial)
    torso.position.y = 1.18

    const shirtHem = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.48), this.sleeveMaterial)
    shirtHem.position.y = 0.74

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.16), this.skinMaterial)
    neck.position.y = 1.72

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), this.skinMaterial)
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.26, 0.68), this.hairMaterial)
    const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), this.shoeMaterial)
    const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), this.shoeMaterial)
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.02), this.shoeMaterial)

    this.headPivot.position.y = 1.86
    head.position.y = 0.31
    hair.position.set(0, 0.55, 0)
    leftEye.position.set(-0.12, 0.33, 0.32)
    rightEye.position.set(0.12, 0.33, 0.32)
    mouth.position.set(0, 0.16, 0.32)
    this.headPivot.add(head, hair, leftEye, rightEye, mouth)

    this.leftArmPivot.position.set(-0.64, 1.46, 0)
    this.rightArmPivot.position.set(0.64, 1.46, 0)
    this.leftLegPivot.position.set(-0.22, 0.78, 0)
    this.rightLegPivot.position.set(0.22, 0.78, 0)

    this.leftArmPivot.add(this.createArm())
    this.rightArmPivot.add(this.createArm())
    this.leftLegPivot.add(this.createLeg())
    this.rightLegPivot.add(this.createLeg())

    this.root.add(
      this.shadow,
      torso,
      shirtHem,
      neck,
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

    const runStrength = THREE.MathUtils.clamp(state.horizontalSpeed / 4.3, 0, 1)

    if (state.grounded) {
      this.walkTime += state.deltaSeconds * (5.5 + runStrength * 9.5)
    } else {
      this.walkTime += state.deltaSeconds * 4.2
    }

    const swing = Math.sin(this.walkTime) * (0.18 + runStrength * 0.54)
    const counterSwing = Math.sin(this.walkTime + Math.PI) * (0.18 + runStrength * 0.54)
    const lift = state.grounded ? 0 : THREE.MathUtils.clamp(-state.verticalVelocity * 0.032, -0.24, 0.34)
    const airborneTilt = state.grounded ? 0 : THREE.MathUtils.clamp(state.verticalVelocity * 0.036, -0.22, 0.24)
    const bob = state.grounded ? Math.abs(Math.sin(this.walkTime * 0.5)) * runStrength * 0.04 : 0.04

    this.root.position.y += bob
    this.shadow.scale.setScalar(1 - Math.min(0.2, Math.abs(lift) * 0.32))
    this.headPivot.rotation.x = airborneTilt * 0.35
    this.headPivot.rotation.z = -swing * 0.05
    this.leftArmPivot.rotation.x = swing - lift * 0.28
    this.rightArmPivot.rotation.x = counterSwing - lift * 0.28
    this.leftLegPivot.rotation.x = counterSwing + lift
    this.rightLegPivot.rotation.x = swing + lift
  }

  dispose(): void {
    this.torsoMaterial.dispose()
    this.sleeveMaterial.dispose()
    this.pantsMaterial.dispose()
    this.shoeMaterial.dispose()
    this.skinMaterial.dispose()
    this.hairMaterial.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
      }
    })
  }

  private createArm(): THREE.Group {
    const group = new THREE.Group()
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), this.sleeveMaterial)
    sleeve.position.y = -0.14
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.26), this.skinMaterial)
    forearm.position.y = -0.52
    group.add(sleeve, forearm)
    return group
  }

  private createLeg(): THREE.Group {
    const group = new THREE.Group()
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.68, 0.3), this.pantsMaterial)
    leg.position.y = -0.34
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.38), this.shoeMaterial)
    shoe.position.set(0, -0.72, 0.04)
    group.add(leg, shoe)
    return group
  }
}

function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  const deltaAngle = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI
  return current + deltaAngle * (1 - Math.exp(-lambda * delta))
}
