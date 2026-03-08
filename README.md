# voxel-sandbox-threejs

ブラウザで即遊べる Minecraft 風のボクセルサンドボックスです。Three.js r183、Vite、Pointer Lock、一人称移動、DDA ブロック選択、チャンクメッシュ最適化、AABB 物理に加えて、スマホ用のタッチ操作も実装しています。

公開 URL: https://awano27.github.io/voxel-sandbox-threejs/

![Gameplay screenshot](./docs/public-playwright-check.png)

## Features

- Three.js + Vite + TypeScript 構成
- 16 x 16 x 64 チャンクと面カリング済みの merged geometry
- Simplex Noise ベースの自然地形
- PointerLockControls での一人称視点
- スマホ向けの仮想スティック、視点パッド、JUMP / BREAK / PLACE / SNEAK ボタン
- 重力、ジャンプ、AABB 衝突判定
- DDA による精密なブロック選択
- 左クリック破壊、右クリック設置
- 1-5 キーで Grass / Dirt / Stone / Wood / Glass を切り替え
- Stats.js による FPS 表示

## Controls

PC:

- Click: マウスキャプチャ開始
- ESC: Pointer Lock 解除
- WASD: 移動
- Shift: スニーク
- Space: ジャンプ
- 左クリック: ブロック破壊
- 右クリック: ブロック設置
- 1-5: ブロック切り替え

Mobile:

- 左スティック: 移動
- 右側の LOOK パッド: 視点移動
- JUMP: ジャンプ
- BREAK: ブロック破壊
- PLACE: ブロック設置
- SNEAK: スニーク
- ホットバータップ: ブロック切り替え

## Local Development

```bash
npm install
npm run dev
```

Vite は `http://127.0.0.1:5173` で起動します。

## Playwright QA

ローカル確認:

```bash
npm run dev
npm run qa:local
```

公開 URL 確認:

```bash
npm run qa:public
```

モバイル確認:

```bash
npm run dev
npm run qa:mobile
```

生成されたスクリーンショットは `docs/` 配下に保存されます。

## Deployment

`main` ブランチに push すると GitHub Actions が `npm run build` を実行し、その成果物を `gh-pages` ブランチへ自動デプロイします。

## Project Structure

```text
src/
  main.ts
  VoxelSandboxGame.ts
  player/
    InputController.ts
    Player.ts
  world/
    BlockTypes.ts
    Chunk.ts
    ChunkManager.ts
    DDA.ts
    SimplexNoise.ts
    TerrainGenerator.ts
    VoxelMeshBuilder.ts
    World.ts
scripts/
  qa-local.mjs
  qa-public.mjs
```
