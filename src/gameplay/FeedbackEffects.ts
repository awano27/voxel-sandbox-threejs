import * as THREE from 'three'

interface BurstOptions {
  count: number
  origin: THREE.Vector3
  colors: string[]
  speed: [number, number]
  spread: number
  lifetime: [number, number]
  scale: [number, number]
  gravity?: number
}

interface Particle {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
  lifetime: number
  maxLifetime: number
  gravity: number
  startScale: number
  endScale: number
}

export class FeedbackEffects {
  readonly root = new THREE.Group()
  private readonly particleGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly particles: Particle[] = []

  constructor(scene: THREE.Scene) {
    this.root.name = 'feedback-effects'
    scene.add(this.root)
  }

  dispose(): void {
    for (const particle of this.particles) {
      particle.mesh.geometry.dispose()
      particle.mesh.material.dispose()
    }

    this.particles.length = 0
    this.root.removeFromParent()
    this.particleGeometry.dispose()
  }

  update(deltaSeconds: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]
      particle.lifetime -= deltaSeconds

      if (particle.lifetime <= 0) {
        particle.mesh.removeFromParent()
        particle.mesh.material.dispose()
        this.particles.splice(index, 1)
        continue
      }

      particle.velocity.y -= particle.gravity * deltaSeconds
      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds)
      particle.mesh.rotation.x += particle.angularVelocity.x * deltaSeconds
      particle.mesh.rotation.y += particle.angularVelocity.y * deltaSeconds
      particle.mesh.rotation.z += particle.angularVelocity.z * deltaSeconds

      const progress = 1 - particle.lifetime / particle.maxLifetime
      const currentScale = THREE.MathUtils.lerp(particle.startScale, particle.endScale, progress)
      particle.mesh.scale.setScalar(currentScale)
      particle.mesh.material.opacity = 1 - progress
    }
  }

  spawnBurst(options: BurstOptions): void {
    for (let index = 0; index < options.count; index += 1) {
      const direction = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(2),
        THREE.MathUtils.randFloat(0.2, 1.35),
        THREE.MathUtils.randFloatSpread(2),
      ).normalize()
      const speed = THREE.MathUtils.randFloat(options.speed[0], options.speed[1])
      const maxLifetime = THREE.MathUtils.randFloat(options.lifetime[0], options.lifetime[1])
      const startScale = THREE.MathUtils.randFloat(options.scale[0], options.scale[1])
      const endScale = startScale * THREE.MathUtils.randFloat(0.18, 0.42)
      const color = options.colors[index % options.colors.length]
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.34,
        metalness: 0.08,
        transparent: true,
        opacity: 1,
      })
      const mesh = new THREE.Mesh(this.particleGeometry, material)
      mesh.position.copy(options.origin)
      mesh.position.x += THREE.MathUtils.randFloatSpread(options.spread)
      mesh.position.y += THREE.MathUtils.randFloat(-0.18, options.spread * 0.45)
      mesh.position.z += THREE.MathUtils.randFloatSpread(options.spread)
      mesh.scale.setScalar(startScale)
      this.root.add(mesh)

      this.particles.push({
        mesh,
        velocity: direction.multiplyScalar(speed),
        angularVelocity: new THREE.Vector3(
          THREE.MathUtils.randFloat(-8, 8),
          THREE.MathUtils.randFloat(-8, 8),
          THREE.MathUtils.randFloat(-8, 8),
        ),
        lifetime: maxLifetime,
        maxLifetime,
        gravity: options.gravity ?? 8.5,
        startScale,
        endScale,
      })
    }
  }
}
