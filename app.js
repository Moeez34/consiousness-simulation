import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ==========================================
// 1. ENGINE & THREE.JS SETUP
// ==========================================
const canvas = document.querySelector('#world');
const povOverlay = document.querySelector('#povOverlay');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);

// Orbit Controls for free-cam / god mode
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 180;
controls.minDistance = 3;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.enabled = false;

// Raycaster for interactive flower planting
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ==========================================
// 2. LIGHTING & DYNAMIC ATMOSPHERE
// ==========================================
const skyPresets = {
  noon: { sky: '#82cbf0', fog: '#ace0fa', sun: '#fff5d1', hemiSky: '#d8f4ff', hemiGround: '#355928', sunPos: [-45, 60, -35], exposure: 1.2 },
  golden: { sky: '#e89855', fog: '#f4bd8b', sun: '#ffa048', hemiSky: '#ffd59f', hemiGround: '#432917', sunPos: [-65, 26, -30], exposure: 1.25 },
  twilight: { sky: '#16233a', fog: '#1e304b', sun: '#799ccd', hemiSky: '#2b476e', hemiGround: '#121d17', sunPos: [-40, 18, -40], exposure: 0.95 }
};

let currentSkyPreset = 'noon';
scene.background = new THREE.Color(skyPresets.noon.sky);
scene.fog = new THREE.Fog(skyPresets.noon.fog, 55, 175);

const hemiLight = new THREE.HemisphereLight(skyPresets.noon.hemiSky, skyPresets.noon.hemiGround, 2.2);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(skyPresets.noon.sun, 3.8);
sunLight.position.set(-45, 60, -35);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -65;
sunLight.shadow.camera.right = 65;
sunLight.shadow.camera.top = 65;
sunLight.shadow.camera.bottom = -65;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 200;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);

// ==========================================
// 3. SHARED VOXEL MATERIALS & GEOMETRIES
// ==========================================
const mat = (color, roughness = 0.8) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const materials = {
  grass: mat('#5aa437'),
  grassAlt: mat('#4a8d2c'),
  grassHigh: mat('#66b53c'),
  dirt: mat('#6b4c2b'),
  stone: mat('#7a8187'),
  stoneDark: mat('#5e6368'),
  sand: mat('#e2d095'),
  woodOak: mat('#6a4c2b'),
  woodBirch: mat('#dfdcd4'),
  woodPlank: mat('#885e38'),
  woodDark: mat('#422d19'),
  leafOak1: mat('#38842d'),
  leafOak2: mat('#489c3c'),
  leafOak3: mat('#286b1f'),
  leafBirch: mat('#65a73e'),
  roof: mat('#524235'),
  chimney: mat('#827b74'),
  flowerRed: mat('#e63946'),
  flowerYellow: mat('#ffc300'),
  flowerPurple: mat('#9d4edd'),
  flowerBlue: mat('#3a86ff'),
  flowerPink: mat('#ff70a6'),
  stem: mat('#3d8534'),
  hiveBox: mat('#e29f32'),
  hiveStrip: mat('#8a581a'),
  hazard: mat('#b23838'),
  cloud: new THREE.MeshLambertMaterial({ color: '#f5fafc', transparent: true, opacity: 0.88, flatShading: true }),
  water: new THREE.MeshPhongMaterial({
    color: '#288acf',
    transparent: true,
    opacity: 0.82,
    shininess: 95,
    flatShading: true
  })
};

// Reusable block geometries
const blockGeo = new THREE.BoxGeometry(2, 1, 2);
const blockGeoTall = new THREE.BoxGeometry(2, 2.4, 2);

// ==========================================
// 4. CONTINUOUS PROCEDURAL NOISE & BIOMES
// ==========================================
// Deterministic Hash / Pseudo-random generator for chunks
function hash2D(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

// Continuous Winding River Channel Formula
function getRiverOffset(z) {
  return Math.sin(z * 0.035) * 16 + Math.sin(z * 0.09) * 7;
}

// Infinite Continuous Heightmap Formula
function getTerrainElevation(x, z) {
  const riverX = getRiverOffset(z);
  const riverDist = Math.abs(x - riverX);

  if (riverDist < 5.6) {
    return -1.45; // Water channel bed
  }

  // Multi-frequency rolling hills
  const h1 = Math.sin(x * 0.045) * Math.cos(z * 0.04) * 2.8;
  const h2 = Math.sin((x * 0.08 + z * 0.06)) * 1.8;
  const h3 = Math.cos((x * 0.02 - z * 0.03)) * 2.2;

  // Mountain ridge factor in certain sectors
  const ridgeNoise = Math.sin(x * 0.015 + 1.2) * Math.cos(z * 0.018);
  const ridge = ridgeNoise > 0.4 ? (ridgeNoise - 0.4) * 10 : 0;

  // Quantized step-like voxel heights
  const rawH = h1 + h2 + h3 + ridge;
  return Math.round(rawH * 0.5) * 0.8 - 0.1;
}

// Biome Classifier
function getBiomeAt(x, z) {
  const riverDist = Math.abs(x - getRiverOffset(z));
  if (riverDist < 7.8) return 'Riverside Bank';
  const elev = getTerrainElevation(x, z);
  if (elev > 2.8) return 'Rocky Ridge';
  if (hash2D(Math.floor(x / 32), Math.floor(z / 32)) > 0.55) return 'Dense Forest';
  return 'Lush Meadow';
}

// ==========================================
// 5. CHUNK-BASED PROCEDURAL WORLD STREAMER
// ==========================================
const CHUNK_SIZE = 16;       // 16 world units per chunk (8x8 blocks of size 2)
const RENDER_RADIUS = 3;    // 7x7 grid = 49 active chunks
const loadedChunks = new Map();
const activeFlowers = [];
const activeHazards = [];
const worldRoot = new THREE.Group();
scene.add(worldRoot);

const groundRaycastMeshes = [];

class VoxelChunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = `${cx},${cz}`;
    this.worldX = cx * CHUNK_SIZE;
    this.worldZ = cz * CHUNK_SIZE;
    this.group = new THREE.Group();
    this.group.position.set(this.worldX, -16, this.worldZ); // starts deep underground for building animation
    this.targetY = 0;
    this.spawnProgress = 0; // 0 to 1 for step-by-step building animation
    this.isBuilt = false;
    this.flowers = [];
    this.hazards = [];

    this.generateTerrain();
    worldRoot.add(this.group);
  }

  generateTerrain() {
    const half = CHUNK_SIZE / 2;
    const step = 2;
    const isOrigin = this.cx === 0 && this.cz === 0;

    let hasWater = false;

    for (let lx = -half + 1; lx <= half - 1; lx += step) {
      for (let lz = -half + 1; lz <= half - 1; lz += step) {
        const wx = this.worldX + lx;
        const wz = this.worldZ + lz;
        const riverX = getRiverOffset(wz);
        const riverDist = Math.abs(wx - riverX);
        const isRiver = riverDist < 5.6;
        const isBank = !isRiver && riverDist < 7.8;
        const elev = isRiver ? -1.45 : getTerrainElevation(wx, wz);

        if (isRiver) hasWater = true;

        let blockMat = isRiver ? materials.dirt : isBank ? materials.sand : materials.grass;
        if (!isRiver && !isBank) {
          if (elev > 2.8) blockMat = materials.stone;
          else if (elev > 0.8) blockMat = materials.grassHigh;
          else if ((Math.abs(Math.floor(wx / 2)) + Math.abs(Math.floor(wz / 2))) % 3 === 0) blockMat = materials.grassAlt;
        }

        // Top voxel block
        const block = new THREE.Mesh(blockGeo, blockMat);
        block.position.set(lx, elev - 0.5, lz);
        block.receiveShadow = true;
        this.group.add(block);
        groundRaycastMeshes.push(block);

        // Sub-surface strata if elevated
        if (elev > 0.7) {
          const subBlock = new THREE.Mesh(blockGeoTall, materials.dirt);
          subBlock.position.set(lx, elev - 1.8, lz);
          subBlock.receiveShadow = true;
          this.group.add(subBlock);
        }
      }
    }

    // River Water plane for chunk if river passes through
    if (hasWater) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), materials.water);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, -0.68, 0);
      this.group.add(water);
    }

    // Procedural Flora & Features
    if (isOrigin) {
      this.buildHomesteadAndHive();
    } else {
      this.buildProceduralFeatures();
    }
  }

  buildProceduralFeatures() {
    const seed = hash2D(this.cx, this.cz);
    const biome = getBiomeAt(this.worldX, this.worldZ);

    // Tree generation
    const treeCount = biome === 'Dense Forest' ? 2 + Math.floor(seed * 3) : biome === 'Lush Meadow' ? (seed > 0.6 ? 1 : 0) : (seed > 0.8 ? 1 : 0);
    for (let t = 0; t < treeCount; t++) {
      const tx = (hash2D(this.cx * 3 + t, this.cz * 7) - 0.5) * (CHUNK_SIZE - 6);
      const tz = (hash2D(this.cx * 5 + t, this.cz * 11) - 0.5) * (CHUNK_SIZE - 6);
      const wx = this.worldX + tx;
      const wz = this.worldZ + tz;

      if (Math.abs(wx - getRiverOffset(wz)) > 6.5) {
        const type = hash2D(wx, wz) > 0.5 ? 'birch' : 'oak';
        this.addTree(tx, tz, type, 0.9 + hash2D(tz, wx) * 0.35);
      }
    }

    // Flower generation
    const flowerCount = biome === 'Lush Meadow' ? 2 + Math.floor(seed * 4) : 1 + Math.floor(seed * 2);
    for (let f = 0; f < flowerCount; f++) {
      const fx = (hash2D(this.cx * 9 + f, this.cz * 13) - 0.5) * (CHUNK_SIZE - 4);
      const fz = (hash2D(this.cx * 15 + f, this.cz * 17) - 0.5) * (CHUNK_SIZE - 4);
      const wx = this.worldX + fx;
      const wz = this.worldZ + fz;

      if (Math.abs(wx - getRiverOffset(wz)) > 6.0) {
        this.addFlower(fx, fz);
      }
    }

    // Occasional Hazard Spike (Thorny briar)
    if (seed > 0.82) {
      const hx = (hash2D(this.cx * 21, this.cz * 23) - 0.5) * (CHUNK_SIZE - 6);
      const hz = (hash2D(this.cx * 27, this.cz * 29) - 0.5) * (CHUNK_SIZE - 6);
      this.addHazard(hx, hz);
    }
  }

  addTree(lx, lz, type = 'oak', scale = 1.0) {
    const wx = this.worldX + lx;
    const wz = this.worldZ + lz;
    const groundY = getTerrainElevation(wx, wz);
    const trunkHeight = (type === 'birch' ? 5.5 : 4.2) * scale;
    const trunkMat = type === 'birch' ? materials.woodBirch : materials.woodOak;

    // Trunk
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.2 * scale, trunkHeight, 1.2 * scale), trunkMat);
    trunk.position.set(lx, groundY + trunkHeight / 2, lz);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    this.group.add(trunk);

    // Canopy
    const leafMat = type === 'birch' ? materials.leafBirch : materials.leafOak1;
    const crownBase = groundY + trunkHeight - 0.8;
    for (let ix = -2; ix <= 2; ix++) {
      for (let iz = -2; iz <= 2; iz++) {
        for (let iy = 0; iy <= 2; iy++) {
          if (Math.abs(ix) + Math.abs(iz) + iy * 0.9 <= 3.2 * scale) {
            const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.35 * scale, 1.2 * scale, 1.35 * scale), leafMat);
            leaf.position.set(lx + ix * 1.25 * scale, crownBase + iy * 1.15 * scale, lz + iz * 1.25 * scale);
            leaf.castShadow = true;
            leaf.receiveShadow = true;
            this.group.add(leaf);
          }
        }
      }
    }
  }

  addFlower(lx, lz, species = null) {
    const wx = this.worldX + lx;
    const wz = this.worldZ + lz;
    const groundY = getTerrainElevation(wx, wz);

    const speciesList = [
      { name: 'Poppy', mat: materials.flowerRed, size: 0.85 },
      { name: 'Dandelion', mat: materials.flowerYellow, size: 0.8 },
      { name: 'Lavender', mat: materials.flowerPurple, size: 0.9 },
      { name: 'Bluebell', mat: materials.flowerBlue, size: 0.85 },
      { name: 'Sunflower', mat: materials.flowerYellow, size: 1.05 }
    ];

    const spec = species || speciesList[Math.floor(hash2D(wx * 2.3, wz * 4.1) * speciesList.length)];
    const flowerGroup = new THREE.Group();

    // Stem
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2 * spec.size, 0.12), materials.stem);
    stem.position.y = (1.2 * spec.size) / 2;
    flowerGroup.add(stem);

    // Petals
    const petals = new THREE.Mesh(new THREE.BoxGeometry(0.65 * spec.size, 0.28 * spec.size, 0.65 * spec.size), spec.mat);
    petals.position.y = 1.15 * spec.size;
    flowerGroup.add(petals);

    // Nectar Core
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.28 * spec.size, 0.35 * spec.size, 0.28 * spec.size), materials.flowerYellow);
    core.position.y = 1.2 * spec.size;
    flowerGroup.add(core);

    // Glowing Beacon
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 6),
      new THREE.MeshBasicMaterial({ color: '#ffea75', transparent: true, opacity: 0.9 })
    );
    beacon.position.y = 1.65 * spec.size;
    flowerGroup.add(beacon);

    flowerGroup.position.set(lx, groundY, lz);
    this.group.add(flowerGroup);

    const flowerObj = {
      id: Math.floor(Math.abs(wx * 1000 + wz)),
      name: spec.name,
      worldPos: new THREE.Vector3(wx, groundY + 1.2 * spec.size, wz),
      group: flowerGroup,
      beacon: beacon,
      active: true
    };

    this.flowers.push(flowerObj);
    activeFlowers.push(flowerObj);
  }

  addHazard(lx, lz) {
    const wx = this.worldX + lx;
    const wz = this.worldZ + lz;
    const groundY = getTerrainElevation(wx, wz);
    const spike = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), materials.hazard);
    spike.position.set(lx, groundY + 0.6, lz);
    spike.rotation.y = 0.6;
    this.group.add(spike);

    const hazPos = new THREE.Vector3(wx, groundY + 0.6, wz);
    this.hazards.push(hazPos);
    activeHazards.push(hazPos);
  }

  buildHomesteadAndHive() {
    const groundY = getTerrainElevation(0, 0);

    // Beekeeper Cottage
    for (let ix = -2; ix <= 2; ix++) {
      for (let iz = -2; iz <= 2; iz++) {
        const isWall = Math.abs(ix) === 2 || Math.abs(iz) === 2;
        if (isWall) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 1.4), materials.woodPlank);
          w.position.set(ix * 1.4, groundY + 1.6, iz * 1.4 - 4);
          w.castShadow = true;
          this.group.add(w);
        }
      }
    }

    // Cottage Roof
    for (let level = 0; level < 3; level++) {
      for (let i = -3 + level; i <= 3 - level; i++) {
        const r1 = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.9, 1.3), materials.roof);
        r1.position.set(i * 1.4, groundY + 3.4 + level * 0.9, -6.8 + level * 0.6);
        this.group.add(r1);

        const r2 = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.9, 1.3), materials.roof);
        r2.position.set(i * 1.4, groundY + 3.4 + level * 0.9, -1.2 - level * 0.6);
        this.group.add(r2);
      }
    }

    // Stone Chimney
    for (let cy = 0; cy < 5; cy++) {
      const chim = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), cy % 2 ? materials.chimney : materials.stoneDark);
      chim.position.set(2.8, groundY + 0.8 + cy * 0.9, -3.5);
      this.group.add(chim);
    }

    // Master Hive on Stilts
    [-0.7, 0.7].forEach(hx => {
      [-0.6, 0.6].forEach(hz => {
        const stilt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), materials.woodDark);
        stilt.position.set(hx - 5, groundY + 0.4, hz + 3);
        this.group.add(stilt);
      });
    });

    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.1 - i * 0.15, 0.7, 1.8 - i * 0.12), materials.hiveBox);
      box.position.set(-5, groundY + 1.0 + i * 0.75, 3);
      this.group.add(box);
    }

    // Hive Landing Board
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.5), materials.woodPlank);
    board.position.set(-5, groundY + 0.85, 4.05);
    this.group.add(board);

    // Initial Meadow Flowers around Home
    [[-3, 6], [-7, 2], [-2, 1], [-8, 7]].forEach(([fx, fz]) => this.addFlower(fx, fz));
  }

  updateAnimation(dt) {
    if (this.isBuilt) return;

    this.spawnProgress += dt * 2.8; // ~0.35s build up
    if (this.spawnProgress >= 1.0) {
      this.spawnProgress = 1.0;
      this.group.position.y = this.targetY;
      this.isBuilt = true;
    } else {
      // Minecraft rising from below with smooth ease-out spring
      const t = this.spawnProgress;
      const ease = 1 - Math.pow(1 - t, 3);
      this.group.position.y = -16 * (1 - ease);
    }
  }

  dispose() {
    // Remove flowers from active pool
    this.flowers.forEach(f => {
      const idx = activeFlowers.indexOf(f);
      if (idx !== -1) activeFlowers.splice(idx, 1);
    });

    // Remove hazards
    this.hazards.forEach(h => {
      const idx = activeHazards.indexOf(h);
      if (idx !== -1) activeHazards.splice(idx, 1);
    });

    // Remove raycast ground meshes
    this.group.traverse(obj => {
      const rIdx = groundRaycastMeshes.indexOf(obj);
      if (rIdx !== -1) groundRaycastMeshes.splice(rIdx, 1);
    });

    worldRoot.remove(this.group);
  }
}

// Master Hive Origin Position
const hivePosition = new THREE.Vector3(-5, getTerrainElevation(0, 0) + 2.2, 3);

// Dynamic Chunk Streamer
function updateWorldChunks(targetX, targetZ, dt) {
  const centerCx = Math.floor((targetX + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const centerCz = Math.floor((targetZ + CHUNK_SIZE / 2) / CHUNK_SIZE);

  const neededKeys = new Set();

  // Load / Spawn chunks within render distance
  for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      const cx = centerCx + dx;
      const cz = centerCz + dz;
      const key = `${cx},${cz}`;
      neededKeys.add(key);

      if (!loadedChunks.has(key)) {
        const chunk = new VoxelChunk(cx, cz);
        loadedChunks.set(key, chunk);
      }
    }
  }

  // Update chunk animations & cull distant chunks
  for (const [key, chunk] of loadedChunks.entries()) {
    chunk.updateAnimation(dt);

    if (!neededKeys.has(key)) {
      // Chunk is beyond render horizon -> recycle
      chunk.dispose();
      loadedChunks.delete(key);
    }
  }
}

// ==========================================
// 6. DETAILED 3D VOXEL BEE AGENT
// ==========================================
function buildBee() {
  const bee = new THREE.Group();

  const beeYellow = mat('#ffc72c');
  const beeBlack = mat('#29190d');
  const beeDark = mat('#140b05');
  const eyeMat = new THREE.MeshPhongMaterial({ color: '#0c1a24', shininess: 80 });
  const wingMat = new THREE.MeshPhongMaterial({
    color: '#e4f7ff',
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    shininess: 90
  });
  const pollenMat = new THREE.MeshLambertMaterial({ color: '#ffb703' });

  // Thorax
  const thorax = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.05, 1.1), beeYellow);
  thorax.position.set(0.2, 0, 0);
  bee.add(thorax);

  // Abdomen
  const abdomen = new THREE.Group();
  abdomen.position.set(1.4, 0, 0);

  const ab1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.0, 1.02), beeBlack);
  abdomen.add(ab1);

  const ab2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.95, 0.98), beeYellow);
  ab2.position.x = 0.4;
  abdomen.add(ab2);

  const ab3 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.88, 0.9), beeBlack);
  ab3.position.x = 0.8;
  abdomen.add(ab3);

  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), beeDark);
  stinger.rotation.z = -Math.PI / 2;
  stinger.position.x = 1.15;
  abdomen.add(stinger);

  bee.add(abdomen);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.95), beeYellow);
  head.position.set(-0.75, -0.05, 0);
  bee.add(head);

  // Compound Eyes
  [-0.34, 0.34].forEach(z => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.28), eyeMat);
    eye.position.set(-1.18, 0.04, z);
    bee.add(eye);
  });

  // Wings
  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), wingMat);
  leftWing.position.set(0.1, 0.55, -0.75);
  bee.add(leftWing);

  const rightWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), wingMat);
  rightWing.position.set(0.1, 0.55, 0.75);
  bee.add(rightWing);

  // Pollen Baskets (Corbiculae)
  const pollenBaskets = [];
  [-0.45, 0.45].forEach(z => {
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.28), pollenMat);
    basket.position.set(0.6, -0.48, z);
    basket.visible = false;
    bee.add(basket);
    pollenBaskets.push(basket);
  });

  bee.scale.setScalar(0.75);
  bee.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  scene.add(bee);
  return { bee, leftWing, rightWing, pollenBaskets, abdomen };
}

const { bee: beeMesh, leftWing, rightWing, pollenBaskets, abdomen } = buildBee();

// Drifting Clouds
const cloudsGroup = new THREE.Group();
function buildClouds() {
  for (let c = 0; c < 12; c++) {
    const cloud = new THREE.Group();
    const clen = 4 + Math.floor(Math.random() * 5);
    const cwid = 3 + Math.floor(Math.random() * 4);
    for (let x = 0; x < clen; x++) {
      for (let z = 0; z < cwid; z++) {
        if (Math.random() > 0.25) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.0, 4.5), materials.cloud);
          b.position.set(x * 4.0, 0, z * 4.0);
          cloud.add(b);
        }
      }
    }
    cloud.position.set((Math.random() - 0.5) * 160, 36 + Math.random() * 8, (Math.random() - 0.5) * 160);
    cloudsGroup.add(cloud);
  }
  scene.add(cloudsGroup);
}
buildClouds();

// ==========================================
// 7. SIMULATION & FORAGING CONTROLLER
// ==========================================
const simState = {
  paused: false,
  speed: 1.0,
  cameraMode: 'chase',
  timeOfDay: 'noon',
  visitedCount: 0,
  deliveredCount: 0
};

const beeBrain = {
  position: hivePosition.clone(),
  velocity: new THREE.Vector3(),
  heading: new THREE.Vector3(1, 0, 0),
  nectar: 0,
  maxNectar: 3,
  mode: 'exploring',
  target: null,
  flightTime: 0,
  speedScalar: 5.6,
  homeVector: new THREE.Vector3()
};

function findNearestActiveFlower() {
  const active = activeFlowers.filter(f => f.active);
  if (active.length === 0) return null;
  return active.sort((a, b) => beeBrain.position.distanceToSquared(a.worldPos) - beeBrain.position.distanceToSquared(b.worldPos))[0];
}

function setObjective(text) {
  const el = document.querySelector('#objectiveText');
  if (el) el.textContent = text;
}

// Controller update loop
function updateBee(dt) {
  beeBrain.homeVector.subVectors(hivePosition, beeBrain.position);

  const nearestFlower = findNearestActiveFlower();

  if (beeBrain.nectar >= beeBrain.maxNectar || (!nearestFlower && beeBrain.nectar > 0)) {
    beeBrain.mode = 'returning';
    beeBrain.target = { position: hivePosition, name: 'Home Hive', type: 'hive' };
  } else if (nearestFlower) {
    beeBrain.mode = 'foraging';
    beeBrain.target = { position: nearestFlower.worldPos, name: `${nearestFlower.name} #${nearestFlower.id}`, flower: nearestFlower, type: 'flower' };
  } else {
    beeBrain.mode = 'exploring';
    beeBrain.target = null;
  }

  let desired = new THREE.Vector3();
  if (beeBrain.target) {
    desired.subVectors(beeBrain.target.position, beeBrain.position);
  } else {
    // Wander into new procedural frontier
    desired.set(
      Math.cos(beeBrain.flightTime * 0.18) * 8 + Math.sin(beeBrain.flightTime * 0.06) * 6,
      0,
      Math.sin(beeBrain.flightTime * 0.14) * 8 + Math.cos(beeBrain.flightTime * 0.08) * 6
    );
  }

  // Hazard avoidance
  activeHazards.forEach(h => {
    const diff = beeBrain.position.clone().sub(h);
    const dist = diff.length();
    if (dist < 6.0) {
      desired.add(diff.normalize().multiplyScalar((6.0 - dist) * 3.4));
    }
  });

  desired.y = 0;
  desired.normalize();

  const turnRate = 0.045 * dt * 60;
  beeBrain.heading.lerp(desired, turnRate).normalize();
  beeBrain.velocity.lerp(beeBrain.heading.clone().multiplyScalar(beeBrain.speedScalar * simState.speed), turnRate);

  beeBrain.position.addScaledVector(beeBrain.velocity, dt);

  // Maintain flight hover altitude above continuous procedural terrain
  const groundElevation = getTerrainElevation(beeBrain.position.x, beeBrain.position.z);
  const targetAltitude = Math.max(groundElevation + 2.1, 2.6) + Math.sin(beeBrain.flightTime * 3.0) * 0.32;
  beeBrain.position.y = THREE.MathUtils.lerp(beeBrain.position.y, targetAltitude, 0.06 * dt * 60);

  // Target arrival check
  if (beeBrain.target && beeBrain.position.distanceTo(beeBrain.target.position) < 1.35) {
    if (beeBrain.mode === 'foraging' && beeBrain.target.flower) {
      beeBrain.target.flower.active = false;
      beeBrain.target.flower.beacon.visible = false;
      beeBrain.nectar++;
      simState.visitedCount++;
      setObjective(`Collected nectar from ${beeBrain.target.flower.name}! [${beeBrain.nectar}/${beeBrain.maxNectar}]`);
    } else if (beeBrain.mode === 'returning') {
      simState.deliveredCount += beeBrain.nectar;
      beeBrain.nectar = 0;
      setObjective('🍯 Nectar safely deposited at origin hive! Exploring new chunks…');
    }
    beeBrain.target = null;
  }

  beeBrain.flightTime += dt * simState.speed;

  // Sync 3D Mesh
  beeMesh.position.copy(beeBrain.position);
  beeMesh.rotation.y = Math.atan2(beeBrain.heading.z, beeBrain.heading.x) - Math.PI;
  beeMesh.rotation.z = Math.sin(beeBrain.flightTime * 3.5) * 0.07;
  abdomen.rotation.y = Math.sin(beeBrain.flightTime * 4.0) * 0.08;

  // Wing flapping
  const wingSpeed = 32 * simState.speed;
  leftWing.rotation.x = Math.sin(beeBrain.flightTime * wingSpeed) * 0.65;
  rightWing.rotation.x = -Math.sin(beeBrain.flightTime * wingSpeed) * 0.65;

  // Pollen baskets
  const hasNectar = beeBrain.nectar > 0;
  pollenBaskets.forEach(b => {
    b.visible = hasNectar;
    b.scale.setScalar(0.7 + (beeBrain.nectar / beeBrain.maxNectar) * 0.6);
  });
}

// ==========================================
// 8. MULTI-CAMERA SYSTEM
// ==========================================
let chaseInit = false;

function updateCamera(dt) {
  if (simState.cameraMode === 'chase') {
    povOverlay.classList.remove('active');
    controls.enabled = false;

    const behindOffset = new THREE.Vector3(-beeBrain.heading.x * 7.0, 3.4, -beeBrain.heading.z * 7.0);
    const targetCamPos = beeBrain.position.clone().add(behindOffset);

    if (!chaseInit) {
      camera.position.copy(targetCamPos);
      chaseInit = true;
    } else {
      camera.position.lerp(targetCamPos, 1 - Math.exp(-dt * 4.5));
    }

    const lookAhead = beeBrain.position.clone().add(new THREE.Vector3(beeBrain.heading.x * 4.5, -0.2, beeBrain.heading.z * 4.5));
    camera.lookAt(lookAhead);
  } else if (simState.cameraMode === 'pov') {
    povOverlay.classList.add('active');
    controls.enabled = false;

    const eyeOffset = new THREE.Vector3(beeBrain.heading.x * 0.8, 0.1, beeBrain.heading.z * 0.8);
    camera.position.copy(beeBrain.position.clone().add(eyeOffset));
    const lookTarget = beeBrain.position.clone().add(new THREE.Vector3(beeBrain.heading.x * 12, -0.5, beeBrain.heading.z * 12));
    camera.lookAt(lookTarget);
  } else if (simState.cameraMode === 'orbit') {
    povOverlay.classList.remove('active');
    controls.enabled = true;
    controls.update();
  }
}

// ==========================================
// 9. TELEMETRY & HUD
// ==========================================
function updateHUD() {
  const modeBadge = document.querySelector('#modeBadge');
  if (modeBadge) {
    modeBadge.className = `status-badge ${beeBrain.mode}`;
    modeBadge.textContent = beeBrain.mode.toUpperCase();
  }

  const biome = getBiomeAt(beeBrain.position.x, beeBrain.position.z);
  const biomeReadout = document.querySelector('#biomeReadout');
  if (biomeReadout) biomeReadout.textContent = biome;

  const worldTitle = document.querySelector('#worldTitle');
  if (worldTitle) worldTitle.textContent = `${biome} Biome`;

  const homeDist = beeBrain.position.distanceTo(hivePosition).toFixed(1);
  const homeReadout = document.querySelector('#homeReadout');
  if (homeReadout) homeReadout.textContent = `${homeDist} m`;

  const targetReadout = document.querySelector('#targetReadout');
  if (targetReadout) {
    targetReadout.textContent = beeBrain.target ? beeBrain.target.name : 'Exploring frontier…';
  }

  const altReadout = document.querySelector('#altReadout');
  if (altReadout) altReadout.textContent = `${beeBrain.position.y.toFixed(1)} m`;

  const speedStat = document.querySelector('#speedStatReadout');
  if (speedStat) speedStat.textContent = `${(beeBrain.velocity.length()).toFixed(1)} m/s`;

  const nectarText = document.querySelector('#nectarText');
  if (nectarText) nectarText.textContent = `${beeBrain.nectar} / ${beeBrain.maxNectar}`;

  const nectarBar = document.querySelector('#nectarBar');
  if (nectarBar) {
    nectarBar.style.width = `${(beeBrain.nectar / beeBrain.maxNectar) * 100}%`;
  }

  const visitedEl = document.querySelector('#visitedCount');
  if (visitedEl) visitedEl.textContent = simState.visitedCount;

  const deliveredEl = document.querySelector('#deliveredCount');
  if (deliveredEl) deliveredEl.textContent = simState.deliveredCount;

  const currentCx = Math.floor((beeBrain.position.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const currentCz = Math.floor((beeBrain.position.z + CHUNK_SIZE / 2) / CHUNK_SIZE);

  const coordsEl = document.querySelector('#biomeCoords');
  if (coordsEl) coordsEl.textContent = `X: ${Math.round(beeBrain.position.x)} | Z: ${Math.round(beeBrain.position.z)}`;

  const chunkCoordsEl = document.querySelector('#chunkCoords');
  if (chunkCoordsEl) chunkCoordsEl.textContent = `Chunk [${currentCx}, ${currentCz}]`;

  const chunksCountEl = document.querySelector('#chunksCount');
  if (chunksCountEl) chunksCountEl.textContent = `${loadedChunks.size} Chunks Active`;
}

// ==========================================
// 10. CONTROLS & INTERACTION
// ==========================================
const camBtns = {
  chase: document.querySelector('#camChase'),
  pov: document.querySelector('#camPov'),
  orbit: document.querySelector('#camOrbit')
};

function setCameraMode(mode) {
  simState.cameraMode = mode;
  Object.keys(camBtns).forEach(k => {
    if (camBtns[k]) camBtns[k].classList.toggle('active', k === mode);
  });
  if (mode === 'orbit') {
    controls.target.copy(beeBrain.position);
  }
}

if (camBtns.chase) camBtns.chase.onclick = () => setCameraMode('chase');
if (camBtns.pov) camBtns.pov.onclick = () => setCameraMode('pov');
if (camBtns.orbit) camBtns.orbit.onclick = () => setCameraMode('orbit');

const timeBtn = document.querySelector('#timeBtn');
const timeLabel = document.querySelector('#timeLabel');
const timeIcon = document.querySelector('#timeIcon');

function setTimeOfDay(preset) {
  simState.timeOfDay = preset;
  const cfg = skyPresets[preset];
  scene.background.set(cfg.sky);
  scene.fog.color.set(cfg.fog);
  hemiLight.color.set(cfg.hemiSky);
  hemiLight.groundColor.set(cfg.hemiGround);
  sunLight.color.set(cfg.sun);
  sunLight.position.set(...cfg.sunPos);
  renderer.toneMappingExposure = cfg.exposure;

  if (timeLabel) timeLabel.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
  if (timeIcon) timeIcon.textContent = preset === 'noon' ? '☀️' : preset === 'golden' ? '🌅' : '🌙';
}

if (timeBtn) {
  timeBtn.onclick = () => {
    const cycle = ['noon', 'golden', 'twilight'];
    const next = cycle[(cycle.indexOf(simState.timeOfDay) + 1) % cycle.length];
    setTimeOfDay(next);
  };
}

const toggleButton = document.querySelector('#toggleButton');
if (toggleButton) {
  toggleButton.onclick = () => {
    simState.paused = !simState.paused;
    toggleButton.innerHTML = simState.paused ? '<span>▶</span> Resume' : '<span>⏸</span> Pause';
  };
}

const resetButton = document.querySelector('#resetButton');
if (resetButton) {
  resetButton.onclick = () => {
    beeBrain.position.copy(hivePosition);
    beeBrain.velocity.set(0, 0, 0);
    beeBrain.nectar = 0;
    beeBrain.target = null;
    chaseInit = false;
    activeFlowers.forEach(f => {
      f.active = true;
      f.beacon.visible = true;
    });
    setObjective('Flight reset at the origin hive entrance.');
  };
}

const plantBtn = document.querySelector('#plantBtn');
if (plantBtn) {
  plantBtn.onclick = () => {
    const rx = beeBrain.position.x + (Math.random() - 0.5) * 16;
    const rz = beeBrain.position.z + (Math.random() - 0.5) * 16;
    const cx = Math.floor((rx + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const cz = Math.floor((rz + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cx},${cz}`);
    if (chunk) {
      chunk.addFlower(rx - chunk.worldX, rz - chunk.worldZ);
      setObjective(`Planted a flower in chunk [${cx}, ${cz}]!`);
    }
  };
}

const speedRange = document.querySelector('#speedRange');
const speedOutput = document.querySelector('#speedOutput');
if (speedRange) {
  speedRange.oninput = e => {
    simState.speed = parseFloat(e.target.value);
    if (speedOutput) speedOutput.textContent = `${simState.speed.toFixed(1)}×`;
  };
}

// Click to plant flower
canvas.addEventListener('click', e => {
  if (simState.cameraMode === 'orbit') return;

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(groundRaycastMeshes);
  if (intersects.length > 0) {
    const hit = intersects[0].point;
    const cx = Math.floor((hit.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const cz = Math.floor((hit.z + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cx},${cz}`);
    if (chunk) {
      chunk.addFlower(hit.x - chunk.worldX, hit.z - chunk.worldZ);
      setObjective(`Planted a fresh flower at [${Math.round(hit.x)}, ${Math.round(hit.z)}]!`);
    }
  }
});

function onResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ==========================================
// 11. MAIN ANIMATION & RENDERING LOOP
// ==========================================
let lastTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, (currentTime - lastTime) / 1000);
  lastTime = currentTime;

  if (!simState.paused) {
    updateBee(dt);
  }

  // Update dynamic chunk streaming around bee
  updateWorldChunks(beeBrain.position.x, beeBrain.position.z, dt);

  // Cloud drift relative to bee
  cloudsGroup.position.x = beeBrain.position.x * 0.2;
  cloudsGroup.position.z = beeBrain.position.z * 0.2;
  cloudsGroup.children.forEach(c => {
    c.position.x += 1.1 * dt;
    if (c.position.x > 80) c.position.x = -80;
  });

  // Hovering flower beacon animation
  activeFlowers.forEach(f => {
    if (f.active && f.beacon) {
      f.beacon.position.y = 1.65 + Math.sin(currentTime * 0.004 + f.id) * 0.12;
    }
  });

  updateCamera(dt);
  updateHUD();
  renderer.render(scene, camera);
}

setObjective('Infinite procedural voxel world initialized.');
requestAnimationFrame(animate);
