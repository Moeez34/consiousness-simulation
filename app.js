import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CentralComplexBrain } from './cx_brain.js';

// ==========================================
// 1. ENGINE & SCENE SETUP
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

// Orbit Controls (Observer god view)
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxDistance = 180;
controls.minDistance = 3;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.enabled = false;

// Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ==========================================
// 2. LIGHTING & ENVIRONMENT
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
// 3. SHARED MATERIALS
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
  stem: mat('#3d8534'),
  hiveBox: mat('#e29f32'),
  hazard: mat('#b23838'),
  cloud: new THREE.MeshLambertMaterial({ color: '#f5fafc', transparent: true, opacity: 0.88, flatShading: true }),
  water: new THREE.MeshPhongMaterial({ color: '#288acf', transparent: true, opacity: 0.82, shininess: 95, flatShading: true })
};

const blockGeo = new THREE.BoxGeometry(2, 1, 2);
const blockGeoTall = new THREE.BoxGeometry(2, 2.4, 2);

// ==========================================
// 4. PROCEDURAL PROCEDURAL NOISE & TERRAIN
// ==========================================
function hash2D(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function getRiverOffset(z) {
  return Math.sin(z * 0.035) * 16 + Math.sin(z * 0.09) * 7;
}

function getTerrainElevation(x, z) {
  const riverX = getRiverOffset(z);
  const riverDist = Math.abs(x - riverX);
  if (riverDist < 5.6) return -1.45;

  const h1 = Math.sin(x * 0.045) * Math.cos(z * 0.04) * 2.8;
  const h2 = Math.sin((x * 0.08 + z * 0.06)) * 1.8;
  const h3 = Math.cos((x * 0.02 - z * 0.03)) * 2.2;
  const ridgeNoise = Math.sin(x * 0.015 + 1.2) * Math.cos(z * 0.018);
  const ridge = ridgeNoise > 0.4 ? (ridgeNoise - 0.4) * 10 : 0;

  return Math.round((h1 + h2 + h3 + ridge) * 0.5) * 0.8 - 0.1;
}

function getBiomeAt(x, z) {
  const riverDist = Math.abs(x - getRiverOffset(z));
  if (riverDist < 7.8) return 'Riverside Bank';
  const elev = getTerrainElevation(x, z);
  if (elev > 2.8) return 'Rocky Ridge';
  if (hash2D(Math.floor(x / 32), Math.floor(z / 32)) > 0.55) return 'Dense Forest';
  return 'Lush Meadow';
}

// ==========================================
// 5. CHUNK SYSTEM
// ==========================================
const CHUNK_SIZE = 16;
const RENDER_RADIUS = 3;
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
    this.group.position.set(this.worldX, -16, this.worldZ);
    this.targetY = 0;
    this.spawnProgress = 0;
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

        const block = new THREE.Mesh(blockGeo, blockMat);
        block.position.set(lx, elev - 0.5, lz);
        block.receiveShadow = true;
        this.group.add(block);
        groundRaycastMeshes.push(block);

        if (elev > 0.7) {
          const subBlock = new THREE.Mesh(blockGeoTall, materials.dirt);
          subBlock.position.set(lx, elev - 1.8, lz);
          subBlock.receiveShadow = true;
          this.group.add(subBlock);
        }
      }
    }

    if (hasWater) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), materials.water);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, -0.68, 0);
      this.group.add(water);
    }

    if (isOrigin) {
      this.buildHomesteadAndHive();
    } else {
      this.buildProceduralFeatures();
    }
  }

  buildProceduralFeatures() {
    const seed = hash2D(this.cx, this.cz);
    const biome = getBiomeAt(this.worldX, this.worldZ);

    const treeCount = biome === 'Dense Forest' ? 2 + Math.floor(seed * 3) : biome === 'Lush Meadow' ? (seed > 0.65 ? 1 : 0) : (seed > 0.8 ? 1 : 0);
    for (let t = 0; t < treeCount; t++) {
      const tx = (hash2D(this.cx * 3 + t, this.cz * 7) - 0.5) * (CHUNK_SIZE - 6);
      const tz = (hash2D(this.cx * 5 + t, this.cz * 11) - 0.5) * (CHUNK_SIZE - 6);
      const wx = this.worldX + tx;
      const wz = this.worldZ + tz;
      if (Math.abs(wx - getRiverOffset(wz)) > 6.5) {
        this.addTree(tx, tz, hash2D(wx, wz) > 0.5 ? 'birch' : 'oak', 0.9 + hash2D(tz, wx) * 0.35);
      }
    }

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
  }

  addTree(lx, lz, type = 'oak', scale = 1.0) {
    const wx = this.worldX + lx;
    const wz = this.worldZ + lz;
    const groundY = getTerrainElevation(wx, wz);
    const trunkHeight = (type === 'birch' ? 5.5 : 4.2) * scale;
    const trunkMat = type === 'birch' ? materials.woodBirch : materials.woodOak;

    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.2 * scale, trunkHeight, 1.2 * scale), trunkMat);
    trunk.position.set(lx, groundY + trunkHeight / 2, lz);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    this.group.add(trunk);

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

  addFlower(lx, lz) {
    const wx = this.worldX + lx;
    const wz = this.worldZ + lz;
    const groundY = getTerrainElevation(wx, wz);

    const speciesList = [
      { name: 'Poppy', mat: materials.flowerRed, size: 0.85 },
      { name: 'Dandelion', mat: materials.flowerYellow, size: 0.8 },
      { name: 'Lavender', mat: materials.flowerPurple, size: 0.9 },
      { name: 'Bluebell', mat: materials.flowerBlue, size: 0.85 }
    ];

    const spec = speciesList[Math.floor(hash2D(wx * 2.3, wz * 4.1) * speciesList.length)];
    const flowerGroup = new THREE.Group();

    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2 * spec.size, 0.12), materials.stem);
    stem.position.y = (1.2 * spec.size) / 2;
    flowerGroup.add(stem);

    const petals = new THREE.Mesh(new THREE.BoxGeometry(0.65 * spec.size, 0.28 * spec.size, 0.65 * spec.size), spec.mat);
    petals.position.y = 1.15 * spec.size;
    flowerGroup.add(petals);

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

  buildHomesteadAndHive() {
    const groundY = getTerrainElevation(0, 0);

    // Cottage
    for (let ix = -2; ix <= 2; ix++) {
      for (let iz = -2; iz <= 2; iz++) {
        if (Math.abs(ix) === 2 || Math.abs(iz) === 2) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 1.4), materials.woodPlank);
          w.position.set(ix * 1.4, groundY + 1.6, iz * 1.4 - 4);
          w.castShadow = true;
          this.group.add(w);
        }
      }
    }

    // Master Hive Box on Stilts
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

    // Initial Flowers around Hive
    [[-3, 6], [-7, 2], [-2, 1], [-8, 7]].forEach(([fx, fz]) => this.addFlower(fx, fz));
  }

  updateAnimation(dt) {
    if (this.isBuilt) return;
    this.spawnProgress += dt * 3.0;
    if (this.spawnProgress >= 1.0) {
      this.spawnProgress = 1.0;
      this.group.position.y = this.targetY;
      this.isBuilt = true;
    } else {
      const ease = 1 - Math.pow(1 - this.spawnProgress, 3);
      this.group.position.y = -16 * (1 - ease);
    }
  }

  dispose() {
    this.flowers.forEach(f => {
      const idx = activeFlowers.indexOf(f);
      if (idx !== -1) activeFlowers.splice(idx, 1);
    });
    this.group.traverse(obj => {
      const rIdx = groundRaycastMeshes.indexOf(obj);
      if (rIdx !== -1) groundRaycastMeshes.splice(rIdx, 1);
    });
    worldRoot.remove(this.group);
  }
}

const hivePosition = new THREE.Vector3(-5, getTerrainElevation(0, 0) + 2.2, 3);

function updateWorldChunks(targetX, targetZ, dt) {
  const centerCx = Math.floor((targetX + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const centerCz = Math.floor((targetZ + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const neededKeys = new Set();

  for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      const cx = centerCx + dx;
      const cz = centerCz + dz;
      const key = `${cx},${cz}`;
      neededKeys.add(key);

      if (!loadedChunks.has(key)) {
        loadedChunks.set(key, new VoxelChunk(cx, cz));
      }
    }
  }

  for (const [key, chunk] of loadedChunks.entries()) {
    chunk.updateAnimation(dt);
    if (!neededKeys.has(key)) {
      chunk.dispose();
      loadedChunks.delete(key);
    }
  }
}

// ==========================================
// 6. DETAILED 3D VOXEL BEE
// ==========================================
function buildBee() {
  const bee = new THREE.Group();
  const beeYellow = mat('#ffc72c');
  const beeBlack = mat('#29190d');
  const beeDark = mat('#140b05');
  const eyeMat = new THREE.MeshPhongMaterial({ color: '#0c1a24', shininess: 80 });
  const wingMat = new THREE.MeshPhongMaterial({ color: '#e4f7ff', transparent: true, opacity: 0.72, side: THREE.DoubleSide, shininess: 90 });
  const pollenMat = new THREE.MeshLambertMaterial({ color: '#ffb703' });

  const thorax = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.05, 1.1), beeYellow);
  thorax.position.set(0.2, 0, 0);
  bee.add(thorax);

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

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.95), beeYellow);
  head.position.set(-0.75, -0.05, 0);
  bee.add(head);

  [-0.34, 0.34].forEach(z => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.28), eyeMat);
    eye.position.set(-1.18, 0.04, z);
    bee.add(eye);
  });

  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), wingMat);
  leftWing.position.set(0.1, 0.55, -0.75);
  bee.add(leftWing);

  const rightWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), wingMat);
  rightWing.position.set(0.1, 0.55, 0.75);
  bee.add(rightWing);

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

// ==========================================
// 7. BIOLOGICAL CENTRAL COMPLEX BRAIN (STONE ET AL. 2017)
// ==========================================
const cxBrain = new CentralComplexBrain({ cpu4_mem_gain: 0.005, noise: 0.008 });

const simState = {
  paused: false,
  speed: 1.0,
  cameraMode: 'chase',
  timeOfDay: 'noon',
  visitedCount: 0,
  deliveredCount: 0
};

const beePhysical = {
  position: hivePosition.clone(),
  velocity: new THREE.Vector3(3.5, 0, 0),
  headingAngle: 0.0, // radians
  speed: 5.4,
  nectar: 0,
  maxNectar: 3,
  state: 'searching', // 'searching' | 'feeding' | 'homing'
  currentTarget: null,
  feedingTimer: 0,
  flightTime: 0
};

// Cognitive log helper
function addCognitiveLog(text) {
  const log = document.querySelector('#cognitiveLog');
  if (log) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = text;
    log.appendChild(entry);
    if (log.children.length > 5) log.removeChild(log.firstChild);
  }
}

function setObjective(text) {
  const el = document.querySelector('#objectiveText');
  if (el) el.textContent = text;
}

// Find closest flower within sensory visual radius
function scanVisualFlowers() {
  const active = activeFlowers.filter(f => f.active);
  if (active.length === 0) return null;
  return active.sort((a, b) => beePhysical.position.distanceToSquared(a.worldPos) - beePhysical.position.distanceToSquared(b.worldPos))[0];
}

// ==========================================
// 8. AUTONOMOUS BIOLOGICAL FLIGHT LOOP
// ==========================================
function updateBeeFlight(dt) {
  const simDt = dt * simState.speed;
  const isHoming = beePhysical.state === 'homing';

  // 1. Calculate optic flow velocity for Central Complex
  const vx = Math.cos(beePhysical.headingAngle) * beePhysical.speed;
  const vz = Math.sin(beePhysical.headingAngle) * beePhysical.speed;

  // 2. Step the biological Central Complex neural network
  const neural = cxBrain.step(beePhysical.headingAngle, vx, vz, isHoming);

  // 3. Autonomous state & steering decisions
  if (beePhysical.state === 'feeding') {
    // Hovering on flower and collecting nectar
    beePhysical.feedingTimer -= simDt;
    beePhysical.speed = THREE.MathUtils.lerp(beePhysical.speed, 0.4, 0.1);

    if (beePhysical.feedingTimer <= 0) {
      beePhysical.nectar++;
      simState.visitedCount++;
      if (beePhysical.currentTarget) {
        beePhysical.currentTarget.active = false;
        beePhysical.currentTarget.beacon.visible = false;
      }

      if (beePhysical.nectar >= beePhysical.maxNectar) {
        beePhysical.state = 'homing';
        setObjective('🍯 Nectar capacity full (3/3). Central Complex homing circuit engaged!');
        addCognitiveLog(`[CPU1] CPU4 memory charged. Homing vector engaged towards hive.`);
      } else {
        beePhysical.state = 'searching';
        setObjective(`Nectar harvested [${beePhysical.nectar}/${beePhysical.maxNectar}]. Resuming flower search.`);
        addCognitiveLog(`[SEARCH] Visual foraging resumed in meadow.`);
      }
      beePhysical.currentTarget = null;
    }
  } else if (beePhysical.state === 'homing') {
    // PURE CENTRAL COMPLEX HOMING:
    // Heading is turned by the Central Complex CPU1 motor steering signal
    beePhysical.speed = THREE.MathUtils.lerp(beePhysical.speed, 5.8, 0.05);

    // Calculate heading difference to home vector bearing
    const targetBearing = neural.decoded_vector.angle;
    let diff = targetBearing - beePhysical.headingAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // Apply biological motor steering torque towards home
    const turnAmount = Math.sign(diff) * Math.min(Math.abs(diff), (2.2 + Math.abs(neural.motor_steering)) * simDt);
    beePhysical.headingAngle += turnAmount;

    // Check if arrived back at origin hive
    const distToHive = beePhysical.position.distanceTo(hivePosition);
    if (distToHive < 2.2) {
      simState.deliveredCount += beePhysical.nectar;
      beePhysical.nectar = 0;
      cxBrain.reset_memory(); // Nest arrival resets path integration memory
      beePhysical.state = 'searching';
      // Head outward in a fresh exploratory direction
      beePhysical.headingAngle += Math.PI * 0.75 + (Math.random() - 0.5) * 0.5;
      setObjective('🍯 Nectar safely deposited at the hive! Central Complex reset for new expedition.');
      addCognitiveLog(`[NEST] Hive arrival. ${simState.deliveredCount} total nectar delivered.`);
    }
  } else {
    // 'searching' mode (Outward foraging)
    beePhysical.speed = THREE.MathUtils.lerp(beePhysical.speed, 5.2, 0.05);

    const nearbyFlower = scanVisualFlowers();
    const flowerDist = nearbyFlower ? beePhysical.position.distanceTo(nearbyFlower.worldPos) : 999;

    if (nearbyFlower && flowerDist < 18.0) {
      // Visual flower attraction
      const angleToFlower = Math.atan2(nearbyFlower.worldPos.z - beePhysical.position.z, nearbyFlower.worldPos.x - beePhysical.position.x);
      let angleDiff = angleToFlower - beePhysical.headingAngle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      beePhysical.headingAngle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), 2.2 * simDt);

      if (flowerDist < 1.25) {
        beePhysical.state = 'feeding';
        beePhysical.currentTarget = nearbyFlower;
        beePhysical.feedingTimer = 1.4; // 1.4 seconds hover
        setObjective(`Sipping nectar from ${nearbyFlower.name}…`);
        addCognitiveLog(`[FEED] Landed on ${nearbyFlower.name}. Nectar uptake active.`);
      }
    } else {
      // Wide natural search sweeps (Levy exploration path)
      const wander = Math.sin(beePhysical.flightTime * 0.4) * 0.35 + Math.cos(beePhysical.flightTime * 0.15) * 0.2;
      beePhysical.headingAngle += wander * simDt;
    }
  }

  // Update physical velocity & position
  beePhysical.velocity.set(
    Math.cos(beePhysical.headingAngle) * beePhysical.speed,
    0,
    Math.sin(beePhysical.headingAngle) * beePhysical.speed
  );

  beePhysical.position.addScaledVector(beePhysical.velocity, simDt);

  // Flight hover altitude above terrain
  const groundY = getTerrainElevation(beePhysical.position.x, beePhysical.position.z);
  const targetAlt = Math.max(groundY + 2.0, 2.5) + Math.sin(beePhysical.flightTime * 3.2) * 0.3;
  beePhysical.position.y = THREE.MathUtils.lerp(beePhysical.position.y, targetAlt, 0.08);

  beePhysical.flightTime += simDt;

  // Sync 3D Mesh
  beeMesh.position.copy(beePhysical.position);
  beeMesh.rotation.y = beePhysical.headingAngle - Math.PI;
  beeMesh.rotation.z = (neural.motor_steering || 0) * 0.15 + Math.sin(beePhysical.flightTime * 3.5) * 0.06;
  abdomen.rotation.y = Math.sin(beePhysical.flightTime * 4.0) * 0.08;

  // Flapping wings
  const wingSpeed = 34 * simState.speed;
  leftWing.rotation.x = Math.sin(beePhysical.flightTime * wingSpeed) * 0.65;
  rightWing.rotation.x = -Math.sin(beePhysical.flightTime * wingSpeed) * 0.65;

  // Pollen baskets
  pollenBaskets.forEach(b => {
    b.visible = beePhysical.nectar > 0;
    b.scale.setScalar(0.7 + (beePhysical.nectar / beePhysical.maxNectar) * 0.6);
  });

  return neural;
}

// ==========================================
// 9. LIVE NEURAL MONITOR & HUD RENDERING
// ==========================================
// Setup TB1 Ring HTML nodes
const tb1RingEl = document.querySelector('#tb1Ring');
const ringNeedleEl = document.querySelector('#ringNeedle');
const tb1Nodes = [];

if (tb1RingEl) {
  for (let i = 0; i < 8; i++) {
    const angle = (i * 2 * Math.PI) / 8 - Math.PI / 2;
    const r = 32; // radius in px
    const x = 40 + Math.cos(angle) * r;
    const y = 40 + Math.sin(angle) * r;
    const node = document.createElement('div');
    node.className = 'ring-node';
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    tb1RingEl.appendChild(node);
    tb1Nodes.push(node);
  }
}

// Setup CPU4 Bars HTML
const cpu4BarsEl = document.querySelector('#cpu4Bars');
const cpu4Fills = [];

if (cpu4BarsEl) {
  for (let i = 0; i < 16; i++) {
    const track = document.createElement('div');
    track.className = 'cpu4-bar-track';
    const fill = document.createElement('div');
    fill.className = 'cpu4-bar-fill';
    fill.style.height = '50%';
    track.appendChild(fill);
    cpu4BarsEl.appendChild(track);
    cpu4Fills.push(fill);
  }
}

function updateNeuralHUD(neural) {
  if (!neural) return;

  // 1. TB1 Ring Attractor
  if (tb1Nodes.length === 8) {
    for (let i = 0; i < 8; i++) {
      const val = neural.tb1[i];
      tb1Nodes[i].style.background = `rgba(247, 201, 86, ${0.1 + val * 0.9})`;
      tb1Nodes[i].style.boxShadow = val > 0.6 ? `0 0 10px rgba(247, 201, 86, ${val * 0.8})` : 'none';
    }
  }

  if (ringNeedleEl) {
    const deg = (beePhysical.headingAngle * 180) / Math.PI;
    ringNeedleEl.style.transform = `rotate(${deg}deg)`;
    const compEl = document.querySelector('#compassDeg');
    if (compEl) compEl.textContent = `${Math.round(((deg % 360) + 360) % 360)}°`;
  }

  // 2. CPU4 Memory Integrator Bars
  if (cpu4Fills.length === 16) {
    for (let i = 0; i < 16; i++) {
      const val = neural.cpu4_mem[i];
      cpu4Fills[i].style.height = `${Math.max(4, val * 100)}%`;
      if (i < 8) {
        cpu4Fills[i].style.background = 'linear-gradient(0deg, #38bdf8, #818cf8)';
      } else {
        cpu4Fills[i].style.background = 'linear-gradient(0deg, #f472b6, #fb923c)';
      }
    }
  }

  // 3. CPU1 Steering Torque Needle
  const gaugeNeedle = document.querySelector('#gaugeNeedle');
  const steerValEl = document.querySelector('#steerVal');
  if (gaugeNeedle && steerValEl) {
    const steer = Math.max(-1.0, Math.min(1.0, neural.motor_steering));
    steerValEl.textContent = `${steer > 0 ? '+' : ''}${steer.toFixed(2)}`;
    gaugeNeedle.style.transform = `scaleX(${steer})`;
    gaugeNeedle.style.background = steer > 0 ? '#4ade80' : '#f87171';
  }

  // 4. Decoded Home Vector
  const decodedVectorEl = document.querySelector('#decodedVectorReadout');
  if (decodedVectorEl && neural.decoded_vector) {
    const dDist = neural.decoded_vector.distance.toFixed(1);
    const dAng = Math.round((neural.decoded_vector.angle * 180) / Math.PI);
    decodedVectorEl.textContent = `${dDist}m @ ${dAng}°`;
  }
}

function updateHUD() {
  const modeBadge = document.querySelector('#modeBadge');
  if (modeBadge) {
    modeBadge.className = `status-badge ${beePhysical.state === 'homing' ? 'returning' : beePhysical.state === 'feeding' ? 'foraging' : 'exploring'}`;
    modeBadge.textContent = beePhysical.state.toUpperCase();
  }

  const biome = getBiomeAt(beePhysical.position.x, beePhysical.position.z);
  const biomeReadout = document.querySelector('#biomeReadout');
  if (biomeReadout) biomeReadout.textContent = biome;

  const homeDist = beePhysical.position.distanceTo(hivePosition).toFixed(1);
  const homeReadout = document.querySelector('#homeReadout');
  if (homeReadout) homeReadout.textContent = `${homeDist} m`;

  const targetReadout = document.querySelector('#targetReadout');
  if (targetReadout) {
    targetReadout.textContent = beePhysical.state === 'homing' ? 'Origin Hive (via Central Complex)' : beePhysical.currentTarget ? `Hovering: ${beePhysical.currentTarget.name}` : 'Searching field for flowers…';
  }

  const altReadout = document.querySelector('#altReadout');
  if (altReadout) altReadout.textContent = `${beePhysical.position.y.toFixed(1)} m`;

  const speedStat = document.querySelector('#speedStatReadout');
  if (speedStat) speedStat.textContent = `${beePhysical.speed.toFixed(1)} m/s`;

  const nectarText = document.querySelector('#nectarText');
  if (nectarText) nectarText.textContent = `${beePhysical.nectar} / ${beePhysical.maxNectar}`;

  const nectarBar = document.querySelector('#nectarBar');
  if (nectarBar) {
    nectarBar.style.width = `${(beePhysical.nectar / beePhysical.maxNectar) * 100}%`;
  }

  const visitedEl = document.querySelector('#visitedCount');
  if (visitedEl) visitedEl.textContent = simState.visitedCount;

  const deliveredEl = document.querySelector('#deliveredCount');
  if (deliveredEl) deliveredEl.textContent = simState.deliveredCount;

  const currentCx = Math.floor((beePhysical.position.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const currentCz = Math.floor((beePhysical.position.z + CHUNK_SIZE / 2) / CHUNK_SIZE);

  const coordsEl = document.querySelector('#biomeCoords');
  if (coordsEl) coordsEl.textContent = `X: ${Math.round(beePhysical.position.x)} | Z: ${Math.round(beePhysical.position.z)}`;

  const chunkCoordsEl = document.querySelector('#chunkCoords');
  if (chunkCoordsEl) chunkCoordsEl.textContent = `Chunk [${currentCx}, ${currentCz}]`;

  const chunksCountEl = document.querySelector('#chunksCount');
  if (chunksCountEl) chunksCountEl.textContent = `${loadedChunks.size} Chunks Active`;
}

// ==========================================
// 10. MULTI-CAMERA SYSTEM
// ==========================================
let chaseInit = false;

function updateCamera(dt) {
  if (simState.cameraMode === 'chase') {
    povOverlay.classList.remove('active');
    controls.enabled = false;

    const headingX = Math.cos(beePhysical.headingAngle);
    const headingZ = Math.sin(beePhysical.headingAngle);

    const behindOffset = new THREE.Vector3(-headingX * 7.0, 3.4, -headingZ * 7.0);
    const targetCamPos = beePhysical.position.clone().add(behindOffset);

    if (!chaseInit) {
      camera.position.copy(targetCamPos);
      chaseInit = true;
    } else {
      camera.position.lerp(targetCamPos, 1 - Math.exp(-dt * 4.5));
    }

    const lookAhead = beePhysical.position.clone().add(new THREE.Vector3(headingX * 4.5, -0.2, headingZ * 4.5));
    camera.lookAt(lookAhead);
  } else if (simState.cameraMode === 'pov') {
    povOverlay.classList.add('active');
    controls.enabled = false;

    const headingX = Math.cos(beePhysical.headingAngle);
    const headingZ = Math.sin(beePhysical.headingAngle);

    const eyeOffset = new THREE.Vector3(headingX * 0.8, 0.1, headingZ * 0.8);
    camera.position.copy(beePhysical.position.clone().add(eyeOffset));
    const lookTarget = beePhysical.position.clone().add(new THREE.Vector3(headingX * 12, -0.5, headingZ * 12));
    camera.lookAt(lookTarget);
  } else if (simState.cameraMode === 'orbit') {
    povOverlay.classList.remove('active');
    controls.enabled = true;
    controls.update();
  }
}

// ==========================================
// 11. OBSERVER CONTROLS
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
    controls.target.copy(beePhysical.position);
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
    beePhysical.position.copy(hivePosition);
    beePhysical.headingAngle = 0;
    beePhysical.nectar = 0;
    beePhysical.state = 'searching';
    beePhysical.currentTarget = null;
    cxBrain.reset_memory();
    chaseInit = false;
    activeFlowers.forEach(f => {
      f.active = true;
      if (f.beacon) f.beacon.visible = true;
    });
    setObjective('Experiment reset at origin hive.');
    addCognitiveLog('[RESET] Central complex and flight state reset.');
  };
}

const plantBtn = document.querySelector('#plantBtn');
if (plantBtn) {
  plantBtn.onclick = () => {
    const rx = beePhysical.position.x + (Math.random() - 0.5) * 16;
    const rz = beePhysical.position.z + (Math.random() - 0.5) * 16;
    const cx = Math.floor((rx + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const cz = Math.floor((rz + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cx},${cz}`);
    if (chunk) {
      chunk.addFlower(rx - chunk.worldX, rz - chunk.worldZ);
      setObjective(`Spawned fresh flower in field [${Math.round(rx)}, ${Math.round(rz)}].`);
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
// 12. MAIN ANIMATION & RENDERING LOOP
// ==========================================
let lastTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, (currentTime - lastTime) / 1000);
  lastTime = currentTime;

  let neural = null;
  if (!simState.paused) {
    neural = updateBeeFlight(dt);
  }

  // Update procedural chunk streaming around the autonomous bee
  updateWorldChunks(beePhysical.position.x, beePhysical.position.z, dt);

  // Drifting clouds
  cloudsGroup.position.x = beePhysical.position.x * 0.2;
  cloudsGroup.position.z = beePhysical.position.z * 0.2;

  // Hovering flower beacons
  activeFlowers.forEach(f => {
    if (f.active && f.beacon) {
      f.beacon.position.y = 1.65 + Math.sin(currentTime * 0.004 + f.id) * 0.12;
    }
  });

  updateCamera(dt);
  updateNeuralHUD(neural);
  updateHUD();
  renderer.render(scene, camera);
}

// Drifting Clouds Group
const cloudsGroup = new THREE.Group();
for (let c = 0; c < 12; c++) {
  const cloud = new THREE.Group();
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 3; z++) {
      if (Math.random() > 0.2) {
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

setObjective('Central Complex autonomous brain experiment active.');
addCognitiveLog('[INIT] Stone et al. (2017) Central Complex online.');
requestAnimationFrame(animate);
