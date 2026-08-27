import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 350);

// Orbit Controls for god/free-cam mode
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxDistance = 140;
controls.minDistance = 3;
controls.maxPolarAngle = Math.PI / 2 - 0.03; // don't go below ground
controls.enabled = false; // enabled when in orbit mode

// Raycaster for interactive flower planting
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ==========================================
// 2. LIGHTING & ATMOSPHERE
// ==========================================
const skyColors = {
  noon: { sky: '#86ccf2', fog: '#aedef8', sun: '#fff4cc', hemiSky: '#d8f2ff', hemiGround: '#395c2e', sunPos: [-45, 55, -30], exposure: 1.2 },
  golden: { sky: '#e89858', fog: '#f2bb8a', sun: '#ffa048', hemiSky: '#ffd29d', hemiGround: '#422818', sunPos: [-60, 24, -30], exposure: 1.25 },
  twilight: { sky: '#18243b', fog: '#20324e', sun: '#7395c9', hemiSky: '#2f4b73', hemiGround: '#121c16', sunPos: [-40, 18, -40], exposure: 0.95 }
};

let currentSky = 'noon';
scene.background = new THREE.Color(skyColors.noon.sky);
scene.fog = new THREE.Fog(skyColors.noon.fog, 45, 190);

const hemiLight = new THREE.HemisphereLight(skyColors.noon.hemiSky, skyColors.noon.hemiGround, 2.2);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(skyColors.noon.sun, 3.8);
sunLight.position.set(-45, 55, -30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -55;
sunLight.shadow.camera.right = 55;
sunLight.shadow.camera.top = 55;
sunLight.shadow.camera.bottom = -55;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 160;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);

// ==========================================
// 3. MATERIAL PALETTE
// ==========================================
const mat = (color, roughness = 0.8) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const materials = {
  grass: mat('#5ba338'),
  grassAlt: mat('#4d8f2e'),
  grassHigh: mat('#68b73f'),
  dirt: mat('#6d4d2b'),
  stone: mat('#7b8288'),
  stoneDark: mat('#606569'),
  sand: mat('#e3d198'),
  woodOak: mat('#6d4e2d'),
  woodBirch: mat('#e0ded6'),
  woodPlank: mat('#885e38'),
  woodDark: mat('#442e1a'),
  leafOak1: mat('#38832e'),
  leafOak2: mat('#499c3d'),
  leafOak3: mat('#296b20'),
  leafBirch: mat('#66a840'),
  roof: mat('#534336'),
  chimney: mat('#837c75'),
  flowerRed: mat('#e63946'),
  flowerYellow: mat('#ffc300'),
  flowerPurple: mat('#9d4edd'),
  flowerBlue: mat('#3a86ff'),
  flowerPink: mat('#ff70a6'),
  stem: mat('#3d8534'),
  hiveBox: mat('#e3a033'),
  hiveStrip: mat('#8c591b'),
  hazard: mat('#b33939'),
  cloud: new THREE.MeshLambertMaterial({ color: '#f3f9fc', transparent: true, opacity: 0.88, flatShading: true }),
  water: new THREE.MeshPhongMaterial({
    color: '#2888cf',
    transparent: true,
    opacity: 0.82,
    shininess: 95,
    flatShading: true
  })
};

// ==========================================
// 4. VOXEL WORLD BUILDER
// ==========================================
const groundGroup = new THREE.Group();
scene.add(groundGroup);

const collidableBlocks = [];

function addBlock(x, y, z, sx, sy, sz, material, castShadow = true, receiveShadow = true, isGround = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.matrixAutoUpdate = true;
  if (isGround) {
    groundGroup.add(mesh);
  } else {
    scene.add(mesh);
  }
  return mesh;
}

// Procedural Height Formula for rolling hills & river channel
function getTerrainHeight(x, z) {
  const riverDist = Math.abs(x - (Math.sin(z * 0.08) * 6 + 2));
  if (riverDist < 5.2) {
    return -1.35; // river bed
  }
  // Hill waves
  const hill1 = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 2.2;
  const hill2 = Math.sin((x + z) * 0.04) * 1.5;
  const mountain = (x < -28) ? Math.max(0, (-28 - x) * 0.28) : 0;
  return Math.round((hill1 + hill2 + mountain) * 0.5) * 0.8 - 0.2;
}

// Build Terrain
function buildTerrain() {
  const size = 36;
  const step = 2;

  for (let x = -size; x <= size; x += step) {
    for (let z = -size; z <= size; z += step) {
      const riverCenter = Math.sin(z * 0.08) * 6 + 2;
      const riverDist = Math.abs(x - riverCenter);
      const isRiver = riverDist < 5.2;
      const isBank = !isRiver && riverDist < 7.6;
      const height = isRiver ? -1.35 : getTerrainHeight(x, z);

      let material = isRiver ? materials.dirt : isBank ? materials.sand : materials.grass;
      if (!isRiver && !isBank) {
        if (x < -24) material = materials.stone;
        else if (height > 0.8) material = materials.grassHigh;
        else if ((x + z) % 4 === 0) material = materials.grassAlt;
      }

      // Top block
      addBlock(x, height / 2, z, step, Math.max(1, height + 2), step, material, false, true, true);

      // Dirt / Stone under-layer for cliff cuts
      if (height > 0.8) {
        addBlock(x, (height - 1.6) / 2, z, step, 1.6, step, materials.dirt, false, true, true);
      }
    }
  }

  // Continuous River Water Mesh
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 92, 16, 40), materials.water);
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.set(2, -0.65, 0);
  scene.add(waterMesh);
}

// Build Trees
function buildTree(x, z, type = 'oak', scale = 1) {
  const groundY = getTerrainHeight(x, z);
  const trunkHeight = (type === 'birch' ? 6 : 4.5) * scale;
  const trunkMat = type === 'birch' ? materials.woodBirch : materials.woodOak;

  // Trunk
  addBlock(x, groundY + trunkHeight / 2, z, 1.2 * scale, trunkHeight, 1.2 * scale, trunkMat);

  // Canopy
  const leafMat1 = type === 'birch' ? materials.leafBirch : materials.leafOak1;
  const leafMat2 = type === 'birch' ? materials.leafBirch : materials.leafOak2;
  const leafMat3 = type === 'birch' ? materials.leafOak3 : materials.leafOak3;

  const crownBase = groundY + trunkHeight - 1;
  const radius = (type === 'birch' ? 2 : 2.5) * scale;

  for (let ix = -2; ix <= 2; ix++) {
    for (let iz = -2; iz <= 2; iz++) {
      for (let iy = 0; iy <= 3; iy++) {
        const d = Math.abs(ix) + Math.abs(iz) + iy * 0.8;
        if (d <= radius * 1.6) {
          const lMat = [leafMat1, leafMat2, leafMat3][Math.abs(ix * 3 + iz * 2 + iy) % 3];
          addBlock(
            x + ix * 1.35 * scale,
            crownBase + iy * 1.25 * scale,
            z + iz * 1.35 * scale,
            1.4 * scale,
            1.3 * scale,
            1.4 * scale,
            lMat
          );
        }
      }
    }
  }
}

// Build Beekeeper Homestead & Hive Apiary
function buildHomestead(x, z) {
  const groundY = getTerrainHeight(x, z);

  // Cottage Foundation & Plank Walls
  for (let ix = -2; ix <= 2; ix++) {
    for (let iz = -2; iz <= 2; iz++) {
      const isCorner = Math.abs(ix) === 2 && Math.abs(iz) === 2;
      const isWall = Math.abs(ix) === 2 || Math.abs(iz) === 2;
      if (isWall) {
        addBlock(x + ix * 1.4, groundY + 1.6, z + iz * 1.4, 1.4, 3.2, 1.4, isCorner ? materials.woodOak : materials.woodPlank);
      }
    }
  }

  // Cottage Gabled Roof
  for (let level = 0; level < 3; level++) {
    for (let i = -3 + level; i <= 3 - level; i++) {
      addBlock(x + i * 1.4, groundY + 3.4 + level * 0.9, z - 2.8 + level * 0.6, 1.45, 0.9, 1.3, materials.roof);
      addBlock(x + i * 1.4, groundY + 3.4 + level * 0.9, z + 2.8 - level * 0.6, 1.45, 0.9, 1.3, materials.roof);
    }
  }

  // Stone Chimney
  for (let cy = 0; cy < 6; cy++) {
    addBlock(x + 2.8, groundY + 0.8 + cy * 0.9, z + 0.5, 1.2, 0.9, 1.2, cy % 2 === 0 ? materials.chimney : materials.stoneDark);
  }

  // Cottage Door
  addBlock(x, groundY + 1.0, z - 2.9, 1.1, 2.0, 0.25, materials.woodDark);

  // Apiary Fences
  for (let fz = -4; fz <= 4; fz += 2) {
    addBlock(x - 5.5, groundY + 0.6, z + fz, 0.25, 1.2, 0.25, materials.woodPlank);
    if (fz < 4) addBlock(x - 5.5, groundY + 0.6, z + fz + 1, 0.15, 0.3, 1.8, materials.woodPlank);
  }
}

// Build Beehive Box
function buildBeehive(x, z) {
  const groundY = getTerrainHeight(x, z);
  // Hive stilts
  addBlock(x - 0.7, groundY + 0.4, z - 0.6, 0.2, 0.8, 0.2, materials.woodDark);
  addBlock(x + 0.7, groundY + 0.4, z - 0.6, 0.2, 0.8, 0.2, materials.woodDark);
  addBlock(x - 0.7, groundY + 0.4, z + 0.6, 0.2, 0.8, 0.2, materials.woodDark);
  addBlock(x + 0.7, groundY + 0.4, z + 0.6, 0.2, 0.8, 0.2, materials.woodDark);

  // Stacked Brood Boxes
  for (let i = 0; i < 3; i++) {
    addBlock(x, groundY + 1.0 + i * 0.75, z, 2.1 - i * 0.15, 0.7, 1.8 - i * 0.12, materials.hiveBox);
    addBlock(x, groundY + 1.35 + i * 0.75, z, 2.15 - i * 0.15, 0.1, 1.85 - i * 0.12, materials.hiveStrip);
  }

  // Hive landing board & entrance slot
  addBlock(x, groundY + 0.85, z + 1.05, 1.4, 0.15, 0.5, materials.woodPlank);
  addBlock(x, groundY + 1.0, z + 0.95, 0.9, 0.2, 0.1, materials.woodDark);

  // Warm glowing hive entrance light
  const hivePointLight = new THREE.PointLight('#ffb732', 1.8, 8);
  hivePointLight.position.set(x, groundY + 1.6, z + 1.2);
  scene.add(hivePointLight);

  return new THREE.Vector3(x, groundY + 2.2, z + 1.2);
}

// Build Voxel Clouds
const cloudsGroup = new THREE.Group();
function buildClouds() {
  const cloudCount = 8;
  for (let c = 0; c < cloudCount; c++) {
    const cloud = new THREE.Group();
    const cx = (Math.random() - 0.5) * 140;
    const cz = (Math.random() - 0.5) * 140;
    const cy = 34 + Math.random() * 8;
    const clen = 4 + Math.floor(Math.random() * 5);
    const cwid = 3 + Math.floor(Math.random() * 4);

    for (let x = 0; x < clen; x++) {
      for (let z = 0; z < cwid; z++) {
        if (Math.random() > 0.25) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.8, 4.2), materials.cloud);
          b.position.set(x * 3.8, 0, z * 3.8);
          cloud.add(b);
        }
      }
    }
    cloud.position.set(cx, cy, cz);
    cloudsGroup.add(cloud);
  }
  scene.add(cloudsGroup);
}

// Build Ambient Pollen Particles
let pollenParticles;
function buildPollenParticles() {
  const count = 350;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = 0.5 + Math.random() * 9;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: '#ffe27a',
    size: 0.22,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending
  });
  pollenParticles = new THREE.Points(geom, mat);
  scene.add(pollenParticles);
}

// ==========================================
// 5. FLOWER GENERATOR & REGISTRY
// ==========================================
const flowers = [];
let flowerIdCounter = 1;

function createFlower(x, z, species = null) {
  const groundY = getTerrainHeight(x, z);
  const speciesList = [
    { name: 'Poppy', mat: materials.flowerRed, colorHex: '#e63946', size: 0.8 },
    { name: 'Dandelion', mat: materials.flowerYellow, colorHex: '#ffc300', size: 0.75 },
    { name: 'Lavender', mat: materials.flowerPurple, colorHex: '#9d4edd', size: 0.9 },
    { name: 'Bluebell', mat: materials.flowerBlue, colorHex: '#3a86ff', size: 0.8 },
    { name: 'Blossom', mat: materials.flowerPink, colorHex: '#ff70a6', size: 0.85 }
  ];

  const spec = species || speciesList[Math.floor(Math.random() * speciesList.length)];
  const flowerGroup = new THREE.Group();

  // Stem
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2 * spec.size, 0.12), materials.stem);
  stem.position.y = (1.2 * spec.size) / 2;
  flowerGroup.add(stem);

  // Petals (Voxel Cross Pattern)
  const petalCenter = new THREE.Mesh(new THREE.BoxGeometry(0.65 * spec.size, 0.3 * spec.size, 0.65 * spec.size), spec.mat);
  petalCenter.position.y = 1.15 * spec.size;
  flowerGroup.add(petalCenter);

  // Golden Nectar Core
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.28 * spec.size, 0.36 * spec.size, 0.28 * spec.size), materials.flowerYellow);
  core.position.y = 1.2 * spec.size;
  flowerGroup.add(core);

  // Soft sparkle beacon mesh
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 6, 6),
    new THREE.MeshBasicMaterial({ color: '#ffea75', transparent: true, opacity: 0.9 })
  );
  beacon.position.y = 1.6 * spec.size;
  flowerGroup.add(beacon);

  flowerGroup.position.set(x, groundY, z);
  scene.add(flowerGroup);

  const flowerData = {
    id: flowerIdCounter++,
    name: spec.name,
    position: new THREE.Vector3(x, groundY + 1.2 * spec.size, z),
    group: flowerGroup,
    beacon: beacon,
    active: true,
    nectarValue: 1
  };

  flowers.push(flowerData);
  return flowerData;
}

// Build Hazards
const hazards = [];
function createHazard(x, z) {
  const groundY = getTerrainHeight(x, z);
  const spikeGroup = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const s = addBlock(
      (Math.random() - 0.5) * 0.8,
      0.6 + i * 0.2,
      (Math.random() - 0.5) * 0.8,
      0.5,
      1.1,
      0.5,
      materials.hazard
    );
    s.rotation.set(Math.random() * 0.3, Math.random() * 3, Math.random() * 0.3);
    spikeGroup.add(s);
  }
  spikeGroup.position.set(x, groundY, z);
  scene.add(spikeGroup);
  hazards.push(new THREE.Vector3(x, groundY + 0.8, z));
}

// ==========================================
// 6. DETAILED VOXEL BEE MODEL
// ==========================================
function buildBee() {
  const bee = new THREE.Group();

  // Materials for Bee
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

  // Thorax (Center)
  const thorax = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.05, 1.1), beeYellow);
  thorax.position.set(0.2, 0, 0);
  bee.add(thorax);

  // Abdomen with Striped Plates
  const abdomen = new THREE.Group();
  abdomen.position.set(1.4, 0, 0);

  const ab1 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.0, 1.02), beeBlack);
  ab1.position.x = 0.0;
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

  // Antennae
  [-0.22, 0.22].forEach(z => {
    const antStem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), beeDark);
    antStem.position.set(-1.08, 0.45, z);
    antStem.rotation.z = -0.35;
    bee.add(antStem);
  });

  // Wings (Left & Right)
  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), wingMat);
  leftWing.position.set(0.1, 0.55, -0.75);
  leftWing.name = 'leftWing';
  bee.add(leftWing);

  const rightWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.85), wingMat);
  rightWing.position.set(0.1, 0.55, 0.75);
  rightWing.name = 'rightWing';
  bee.add(rightWing);

  // Corbiculae (Pollen Baskets on hind legs)
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

// ==========================================
// 7. ASSEMBLE WORLD SCENERY
// ==========================================
buildTerrain();

// Trees (Oaks & Birches along banks and meadow)
buildTree(-22, -20, 'oak', 1.35);
buildTree(-26, 14, 'birch', 1.2);
buildTree(16, -14, 'oak', 1.15);
buildTree(20, 18, 'birch', 1.25);
buildTree(-12, 22, 'oak', 0.95);
buildTree(28, -6, 'oak', 1.1);
buildTree(-28, -4, 'birch', 1.1);
buildTree(12, 26, 'oak', 1.05);

// Homestead & Hives
buildHomestead(18, -4);
const hivePosition = buildBeehive(-8, 12);

// Initial Flower Field
const initialFlowerCoords = [
  [-4, 4], [-13, -2], [-17, 10], [9, 8], [14, 16],
  [-22, 2], [22, -1], [-7, -16], [24, 9], [-2, -10],
  [5, -20], [-18, -12], [11, -8], [-10, 6]
];
initialFlowerCoords.forEach(([x, z]) => createFlower(x, z));

// Hazards
createHazard(-2, 14);
createHazard(11, -2);
createHazard(-14, -8);

// Clouds & Atmosphere
buildClouds();
buildPollenParticles();

// Bee Instance
const { bee: beeMesh, leftWing, rightWing, pollenBaskets, abdomen } = buildBee();

// ==========================================
// 8. SIMULATION STATE & AGENT CONTROLLER
// ==========================================
const simState = {
  paused: false,
  speed: 1.0,
  cameraMode: 'chase', // 'chase' | 'pov' | 'orbit'
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
  mode: 'exploring', // 'exploring' | 'foraging' | 'returning'
  target: null,
  flightTime: 0,
  speedScalar: 5.4,
  homeVector: new THREE.Vector3()
};

function getActiveFlowers() {
  return flowers.filter(f => f.active);
}

function findBestFlower() {
  const active = getActiveFlowers();
  if (active.length === 0) return null;
  return active.sort((a, b) => beeBrain.position.distanceToSquared(a.position) - beeBrain.position.distanceToSquared(b.position))[0];
}

function setObjective(text) {
  const el = document.querySelector('#objectiveText');
  if (el) el.textContent = text;
}

// Controller update loop (Path integration & state machine)
function updateBee(dt) {
  // Update Home Vector (vector from current pos to hive)
  beeBrain.homeVector.subVectors(hivePosition, beeBrain.position);

  // State Machine logic
  const targetFlower = findBestFlower();

  if (beeBrain.nectar >= beeBrain.maxNectar || (!targetFlower && beeBrain.nectar > 0)) {
    // Return home when capacity full
    beeBrain.mode = 'returning';
    beeBrain.target = { position: hivePosition, name: 'Beehive', type: 'hive' };
  } else if (targetFlower) {
    // Forage nearest flower
    beeBrain.mode = 'foraging';
    beeBrain.target = { position: targetFlower.position, name: `${targetFlower.name} #${targetFlower.id}`, flower: targetFlower, type: 'flower' };
  } else {
    // Explore / patrol meadow
    beeBrain.mode = 'exploring';
    beeBrain.target = null;
  }

  // Steering calculation
  let desired = new THREE.Vector3();
  if (beeBrain.target) {
    desired.subVectors(beeBrain.target.position, beeBrain.position);
  } else {
    // Smooth wandering Lissajous path
    desired.set(
      Math.cos(beeBrain.flightTime * 0.22) * 8 + Math.sin(beeBrain.flightTime * 0.08) * 4,
      0,
      Math.sin(beeBrain.flightTime * 0.17) * 8 + Math.cos(beeBrain.flightTime * 0.09) * 4
    );
  }

  // Hazard / obstacle avoidance
  hazards.forEach(h => {
    const diff = beeBrain.position.clone().sub(h);
    const dist = diff.length();
    if (dist < 6.0) {
      desired.add(diff.normalize().multiplyScalar((6.0 - dist) * 3.2));
    }
  });

  desired.y = 0;
  desired.normalize();

  // Smooth heading interpolation & bank
  const turnRate = 0.045 * dt * 60;
  beeBrain.heading.lerp(desired, turnRate).normalize();
  beeBrain.velocity.lerp(beeBrain.heading.clone().multiplyScalar(beeBrain.speedScalar * simState.speed), turnRate);

  // Position integration
  beeBrain.position.addScaledVector(beeBrain.velocity, dt);

  // Flight hover altitude (stay above terrain with gentle bobbing)
  const terrainHeight = getTerrainHeight(beeBrain.position.x, beeBrain.position.z);
  const targetAltitude = Math.max(terrainHeight + 2.0, 2.6) + Math.sin(beeBrain.flightTime * 3.0) * 0.32;
  beeBrain.position.y = THREE.MathUtils.lerp(beeBrain.position.y, targetAltitude, 0.06 * dt * 60);

  // Interaction check (Arrived at target)
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
      setObjective('🍯 Nectar safely deposited at the hive. Resuming meadow forage.');
    }
    beeBrain.target = null;
  }

  beeBrain.flightTime += dt * simState.speed;

  // Sync 3D Mesh
  beeMesh.position.copy(beeBrain.position);
  beeMesh.rotation.y = Math.atan2(beeBrain.heading.z, beeBrain.heading.x) - Math.PI; // Face forward in flight
  beeMesh.rotation.z = Math.sin(beeBrain.flightTime * 3.5) * 0.07; // subtle roll
  abdomen.rotation.y = Math.sin(beeBrain.flightTime * 4.0) * 0.08;

  // Wing flapping animation
  const wingSpeed = 32 * simState.speed;
  leftWing.rotation.x = Math.sin(beeBrain.flightTime * wingSpeed) * 0.65;
  rightWing.rotation.x = -Math.sin(beeBrain.flightTime * wingSpeed) * 0.65;

  // Corbiculae (Pollen Baskets) visibility when carrying nectar
  const hasNectar = beeBrain.nectar > 0;
  pollenBaskets.forEach(b => {
    b.visible = hasNectar;
    b.scale.setScalar(0.7 + (beeBrain.nectar / beeBrain.maxNectar) * 0.6);
  });
}

// ==========================================
// 9. MULTI-CAMERA SYSTEM
// ==========================================
let chaseInit = false;

function updateCamera(dt) {
  if (simState.cameraMode === 'chase') {
    povOverlay.classList.remove('active');
    controls.enabled = false;

    // Smooth 3rd person chase camera behind bee heading
    const behindOffset = new THREE.Vector3(
      -beeBrain.heading.x * 6.8,
      3.2,
      -beeBrain.heading.z * 6.8
    );
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

    // Bee eye first-person perspective
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
// 10. HUD & TELEMETRY UPDATES
// ==========================================
function updateHUD() {
  // Mode Badge
  const modeBadge = document.querySelector('#modeBadge');
  if (modeBadge) {
    modeBadge.className = `status-badge ${beeBrain.mode}`;
    modeBadge.textContent = beeBrain.mode.toUpperCase();
  }

  // Home Vector Distance
  const homeDist = beeBrain.position.distanceTo(hivePosition).toFixed(1);
  const homeReadout = document.querySelector('#homeReadout');
  if (homeReadout) homeReadout.textContent = `${homeDist} m`;

  // Target Readout
  const targetReadout = document.querySelector('#targetReadout');
  if (targetReadout) {
    targetReadout.textContent = beeBrain.target ? beeBrain.target.name : 'Scanning meadow…';
  }

  // Altitude & Speed
  const altReadout = document.querySelector('#altReadout');
  if (altReadout) altReadout.textContent = `${beeBrain.position.y.toFixed(1)} m`;

  const speedStat = document.querySelector('#speedStatReadout');
  if (speedStat) speedStat.textContent = `${(beeBrain.velocity.length()).toFixed(1)} m/s`;

  // Nectar Progress
  const nectarText = document.querySelector('#nectarText');
  if (nectarText) nectarText.textContent = `${beeBrain.nectar} / ${beeBrain.maxNectar}`;

  const nectarBar = document.querySelector('#nectarBar');
  if (nectarBar) {
    const pct = (beeBrain.nectar / beeBrain.maxNectar) * 100;
    nectarBar.style.width = `${pct}%`;
  }

  // Stats
  const visitedEl = document.querySelector('#visitedCount');
  if (visitedEl) visitedEl.textContent = simState.visitedCount;

  const deliveredEl = document.querySelector('#deliveredCount');
  if (deliveredEl) deliveredEl.textContent = simState.deliveredCount;

  // Biome coordinates
  const coordsEl = document.querySelector('#biomeCoords');
  if (coordsEl) coordsEl.textContent = `X: ${Math.round(beeBrain.position.x)} | Z: ${Math.round(beeBrain.position.z)}`;
}

// ==========================================
// 11. USER INTERACTION & CONTROLS
// ==========================================
// Camera Mode Buttons
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

// Time of Day Toggle
const timeBtn = document.querySelector('#timeBtn');
const timeLabel = document.querySelector('#timeLabel');
const timeIcon = document.querySelector('#timeIcon');

function setTimeOfDay(preset) {
  simState.timeOfDay = preset;
  const cfg = skyColors[preset];
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

// Play / Pause Toggle
const toggleButton = document.querySelector('#toggleButton');
if (toggleButton) {
  toggleButton.onclick = () => {
    simState.paused = !simState.paused;
    toggleButton.innerHTML = simState.paused ? '<span>▶</span> Resume' : '<span>⏸</span> Pause';
  };
}

// Reset Flight
const resetButton = document.querySelector('#resetButton');
if (resetButton) {
  resetButton.onclick = () => {
    beeBrain.position.copy(hivePosition);
    beeBrain.velocity.set(0, 0, 0);
    beeBrain.nectar = 0;
    beeBrain.target = null;
    chaseInit = false;
    flowers.forEach(f => {
      f.active = true;
      f.beacon.visible = true;
    });
    setObjective('Flight reset at the hive entrance.');
  };
}

// Plant Flower Button
const plantBtn = document.querySelector('#plantBtn');
if (plantBtn) {
  plantBtn.onclick = () => {
    // Spawn flower near the bee or random scenic spot
    const rx = beeBrain.position.x + (Math.random() - 0.5) * 20;
    const rz = beeBrain.position.z + (Math.random() - 0.5) * 20;
    const fl = createFlower(rx, rz);
    setObjective(`Planted a new ${fl.name} flower at [${Math.round(rx)}, ${Math.round(rz)}]!`);
  };
}

// Speed range slider
const speedRange = document.querySelector('#speedRange');
const speedOutput = document.querySelector('#speedOutput');
if (speedRange) {
  speedRange.oninput = e => {
    simState.speed = parseFloat(e.target.value);
    if (speedOutput) speedOutput.textContent = `${simState.speed.toFixed(1)}×`;
  };
}

// Click anywhere on terrain to plant flower via Raycasting
canvas.addEventListener('click', e => {
  if (simState.cameraMode === 'orbit') return; // let orbit controls drag freely

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(groundGroup.children);
  if (intersects.length > 0) {
    const hit = intersects[0].point;
    const fl = createFlower(hit.x, hit.z);
    setObjective(`Planted a fresh ${fl.name} flower at [${Math.round(hit.x)}, ${Math.round(hit.z)}]!`);
  }
});

// Window resize handler
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
// 12. MAIN ANIMATION LOOP
// ==========================================
let lastTime = performance.now();

function animate(currentTime) {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, (currentTime - lastTime) / 1000);
  lastTime = currentTime;

  if (!simState.paused) {
    updateBee(dt);
  }

  // Animate drifting clouds
  cloudsGroup.children.forEach(c => {
    c.position.x += 1.2 * dt;
    if (c.position.x > 80) c.position.x = -80;
  });

  // Animate hovering flower beacons
  flowers.forEach(f => {
    if (f.active) {
      f.beacon.position.y = 1.6 + Math.sin(currentTime * 0.004 + f.id) * 0.12;
    }
  });

  // Animate pollen particles
  if (pollenParticles) {
    pollenParticles.rotation.y += 0.04 * dt;
  }

  updateCamera(dt);
  updateHUD();
  renderer.render(scene, camera);
}

setObjective('Bee entered the riverside meadow.');
requestAnimationFrame(animate);
