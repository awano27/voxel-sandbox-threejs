// Lightweight seeded simplex noise for rolling terrain generation.
export class SimplexNoise {
  private readonly gradients = new Float32Array([
    1, 1, -1, 1, 1, -1, -1, -1,
    1, 0, -1, 0, 1, 0, -1, 0,
    0, 1, 0, -1, 0, 1, 0, -1,
  ])

  private readonly perm = new Uint8Array(512)

  constructor(seed: number) {
    const random = mulberry32(seed)
    const base = new Uint8Array(256)

    for (let index = 0; index < 256; index += 1) {
      base[index] = index
    }

    for (let index = 255; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1))
      const next = base[index]
      base[index] = base[swapIndex]
      base[swapIndex] = next
    }

    for (let index = 0; index < 512; index += 1) {
      this.perm[index] = base[index & 255]
    }
  }

  noise2D(x: number, y: number): number {
    const skewFactor = 0.5 * (Math.sqrt(3) - 1)
    const unskewFactor = (3 - Math.sqrt(3)) / 6

    const skewed = (x + y) * skewFactor
    const cellX = fastFloor(x + skewed)
    const cellY = fastFloor(y + skewed)

    const originUnskew = (cellX + cellY) * unskewFactor
    const x0 = x - (cellX - originUnskew)
    const y0 = y - (cellY - originUnskew)

    const stepX = x0 > y0 ? 1 : 0
    const stepY = x0 > y0 ? 0 : 1

    const x1 = x0 - stepX + unskewFactor
    const y1 = y0 - stepY + unskewFactor
    const x2 = x0 - 1 + 2 * unskewFactor
    const y2 = y0 - 1 + 2 * unskewFactor

    const ii = cellX & 255
    const jj = cellY & 255

    const gi0 = this.perm[ii + this.perm[jj]] % 12
    const gi1 = this.perm[ii + stepX + this.perm[jj + stepY]] % 12
    const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12

    const contribution0 = simplexContribution(this.gradients, gi0, x0, y0)
    const contribution1 = simplexContribution(this.gradients, gi1, x1, y1)
    const contribution2 = simplexContribution(this.gradients, gi2, x2, y2)

    return 70 * (contribution0 + contribution1 + contribution2)
  }
}

function simplexContribution(gradients: Float32Array, gradientIndex: number, x: number, y: number): number {
  let t = 0.5 - x * x - y * y

  if (t < 0) {
    return 0
  }

  t *= t
  const base = gradientIndex * 2

  return t * t * (gradients[base] * x + gradients[base + 1] * y)
}

function fastFloor(value: number): number {
  return value >= 0 ? value | 0 : (value | 0) - 1
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let result = Math.imul(state ^ (state >>> 15), state | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}
