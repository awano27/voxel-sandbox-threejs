import './style.css'
import { VoxelSandboxGame } from './VoxelSandboxGame'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app mount node')
}

const game = new VoxelSandboxGame(app)

window.addEventListener('beforeunload', () => game.dispose())
