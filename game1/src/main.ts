import * as THREE from 'three';
import * as GAME from 'vibegame';
import { DefaultPlugins } from 'vibegame/defaults';
import { PlayerPlugin } from 'vibegame/player';
import { StartupPlugin } from 'vibegame/startup';
import { RespawnPlugin } from 'vibegame/respawn';
import { PhysicsWorld, Body, CollisionEvents, TouchedEvent, SetLinearVelocity } from 'vibegame/physics';
import { InputState, consumePrimary, INPUT_CONFIG } from 'vibegame/input';
import { OrbitCamera } from 'vibegame/orbit-camera';
import { Transform } from 'vibegame/transforms';
import {
  setCanvasElement,
  RenderContext,
  Renderer,
  getScene,
  threeCameras,
  getRenderingContext,
} from 'vibegame/rendering';

const mappings = INPUT_CONFIG.mappings as unknown as { primaryAction: string[] };
mappings.primaryAction = ['Space', 'MouseLeft'];

const S = 2.4;

/* Палитра и читаемость в духе Atari 2600 River Raid — ярко, контрастно */
const C = {
  water: '#3cb0f0',
  bankGrass: '#2ca028',
  bankMeadow: '#44c038',
  bankSand: '#d8b060',
  planeBody: '#f2f4f8',
  planeWing: '#f0c818',
  planeTail: '#e8b010',
  planeNose: '#2c2c34',
  planeCockpit: '#3a5080',
  bullet: '#fff8a0',
  enemyHelo: '#c018c8',
  enemyJet: '#9098a8',
  enemyShip: '#6b3c18',
  wake: '#a8e8ff',
  bridgeWood: '#704028',
  bridgeRail: '#5a3418',
  tree: '#1a6a12',
  channelMark: '#f8f878',
} as const;

/** Очки как в мануалах/стратегиях River Raid */
const SCORE_HELO = 60;
const SCORE_SHIP = 30;
const SCORE_JET = 100;
const SCORE_DEPOT = 80;
const SCORE_BRIDGE = 500;

const BASE_FORWARD = 20 * S;
const STRAFE_SPEED = 12 * S * 1.85;
const MISSILE_SPEED = 58 * S;
const ENEMY_HELO_SPEED = 9 * S;
const ENEMY_SHIP_SPEED = 6.5 * S;
const ENEMY_JET_SPEED = 11 * S;
const SHOOT_COOLDOWN = 0.42;
const ENEMY_SPAWN_EVERY = 2.05;
const FLOW_COUNT = 28;

const RIVER_WIDE = 6;
const RIVER_HALF_MAX = 7.4 * S * RIVER_WIDE;
/** Масштаб «запаса» суши за пределами макс. половины русла. */
const BANK_LAND_MUL = 2.15;
const FZ = 1;

const Z_SEG_START = -150 * S;
const Z_SEG_END = 3200 * S;
/** Тонкие срезы вдоль течения. */
const BANK_SLICE = 6.5 * S;
const WATER_BANK_INSET = 1.35 * S;

/**
 * Внешняя грань основного берега (луг/ступени к воде): слева x = -COAST_OUTER.
 * К реке геометрия считается только до ±COAST_OUTER; дальше наружу — полосы COAST_PAD_OUTER.
 */
const COAST_OUTER =
  RIVER_HALF_MAX + (38 + 9 * RIVER_WIDE) * S * (0.42 * BANK_LAND_MUL + 0.52);
const COAST_FADE_BAND = 26 * S;
const COAST_FADE_SLICES = 4;
const SKY_MIST = '#b8e8f8';

const coastMistMeshes: THREE.Mesh[] = [];
let coastMistUnitBox: THREE.BoxGeometry | null = null;

function mistUnitBox(): THREE.BoxGeometry {
  if (!coastMistUnitBox) coastMistUnitBox = new THREE.BoxGeometry(1, 1, 1);
  return coastMistUnitBox;
}

function hexToLinearColor(hex: string): THREE.Color {
  return new THREE.Color(parseInt(hex.slice(1), 16));
}

function addCoastMistStrip(
  state: GAME.State,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: THREE.Color,
  opacity: number,
) {
  const rc = getRenderingContext(state);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: Math.max(0, Math.min(1, opacity)),
    depthWrite: false,
    depthTest: true,
    fog: true,
  });
  const mesh = new THREE.Mesh(mistUnitBox(), mat);
  mesh.position.set(cx, cy, cz);
  mesh.scale.set(sx, sy, sz);
  mesh.renderOrder = 900;
  mesh.frustumCulled = false;
  rc.scene.add(mesh);
  coastMistMeshes.push(mesh);
}

const CAM_YAW = Math.PI;
const CAM_PITCH = 1.38;
const CAM_DIST = 92 * S * 1.72;

/** FOV основной камеры (MainCamera default) — только для запаса суши за экраном, не для обрыва. */
const MAIN_CAM_FOV_DEG = 75;
const COAST_ASPECT_SAFE = 2.55;
const COAST_VFOV = (MAIN_CAM_FOV_DEG * Math.PI) / 180;
const COAST_HFOV = 2 * Math.atan(Math.tan(COAST_VFOV / 2) * COAST_ASPECT_SAFE);
/** Расширение только наружу от ±COAST_OUTER (левый край мира / правый край мира). */
const COAST_PAD_OUTER = CAM_DIST * Math.tan(COAST_HFOV / 2) * 1.3;
/** |x| у самого внешнего края суши (вода и полосы-продолжения). */
const COAST_WORLD_HALF = COAST_OUTER + COAST_PAD_OUTER;

let planeId = -1;
let cameraId = -1;

const hazardIds = new Set<number>();
const enemyIds = new Set<number>();
const missileIds = new Set<number>();
const flowIds: number[] = [];

/** Смещения визуала от Body (как спрайт RR: белый корпус, жёлтые крылья/хвост, тёмный нос). */
const planeVis: { eid: number; ox: number; oy: number; oz: number; yaw: number }[] = [];
/** Одно жёлтое крыло-треугольник (не box), синхронизируется в syncPlaneRiverRaidVis */
let planeDeltaWingMesh: THREE.Mesh | null = null;
let planeDeltaWingOx = 0;
let planeDeltaWingOy = 0;
let planeDeltaWingOz = 0;

type EnemyKind = 'helo' | 'ship' | 'jet';
const enemyKind = new Map<number, EnemyKind>();

type FuelDepot = {
  cx: number;
  cz: number;
  key: string;
  destroyed: boolean;
  vis: number[];
  /** Столб заправки (Three.js), не ECS-renderer */
  meshes: THREE.Mesh[];
};
const depots: FuelDepot[] = [];

type RefuelRipple = { mesh: THREE.Mesh; t: number };
let refuelRipples: RefuelRipple[] = [];
let refuelRippleSpawnAcc = 0;
let refuelShakePhase = 0;

type Bridge = {
  z: number;
  destroyed: boolean;
  pylL: number;
  pylR: number;
  vis: number[];
};
const bridges: Bridge[] = [];

let shootCooldownLeft = 0;
let enemySpawnTimer = 0;
let initialized = false;
/** Ссылка на мир для кнопки оверлея (после init). */
let uiStateRef: GAME.State | null = null;
type RunState = 'playing' | 'paused_continue' | 'paused_game_over';
let runState: RunState = 'playing';
let score = 0;
let fuel = 100;
/** Сколько машин осталось включая текущую (как «три джета» в оригинале). */
let jetsLeft = 3;
let checkpointZ = 0;
let extraLifeMilestone = 0;
let horizonAtmosphereApplied = false;

/** 0…1, плавно «хаотичная» огибающая по длине реки (детерминированно от z). */
function riverWidthShapeT(z: number): number {
  const t0 = 0.5 + 0.5 * Math.sin(z * 0.0155 + 0.62);
  const t1 = 0.5 + 0.5 * Math.sin(z * 0.0368 - 1.05);
  const t2 = 0.5 + 0.5 * Math.sin(z * 0.061 + 2.33);
  const t3 = 0.5 + 0.5 * Math.sin(z * 0.094 - 0.28);
  return 0.38 * t0 + 0.28 * t1 + 0.22 * t2 + 0.12 * t3;
}

/** Половина ширины воды в точке z (как раньше ~44–100% от макс., но без одной синусоиды). */
function riverHalfAt(z: number): number {
  return RIVER_HALF_MAX * (0.44 + 0.56 * riverWidthShapeT(z));
}

/** Смещение оси реки по X (извилины); амплитуда связана с масштабом русла. */
function riverCenterXAt(z: number): number {
  const m =
    0.48 * Math.sin(z * 0.0131 + 0.15) +
    0.31 * Math.sin(z * 0.0237 - 0.88) +
    0.21 * Math.sin(z * 0.0415 + 1.9);
  const cap = RIVER_HALF_MAX * 0.36;
  return cap * Math.max(-1, Math.min(1, m));
}

function applyRiverHorizonAtmosphere(state: GAME.State) {
  if (horizonAtmosphereApplied) return;
  const sc = getScene(state);
  if (sc) {
    sc.fog = new THREE.Fog(0xb8e8f8, 240 * S, 580 * S);
    horizonAtmosphereApplied = true;
  }
  for (const cam of threeCameras.values()) {
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.far = 25000;
      cam.updateProjectionMatrix();
    }
  }
}

/** Визуал и коллайдер ~×2. Узкий фюзеляж + одно крыло-треугольник (дельта в плане XZ). */
const PLANE_VIS_SCALE = 2;

function disposePlaneDeltaWing(state: GAME.State) {
  if (!planeDeltaWingMesh) return;
  getRenderingContext(state).scene.remove(planeDeltaWingMesh);
  planeDeltaWingMesh.geometry.dispose();
  (planeDeltaWingMesh.material as THREE.MeshBasicMaterial).dispose();
  planeDeltaWingMesh = null;
}

/** Планформа: остриё в +Z, корма по X — как прямоугольник с срезанными передними углами → треугольник сверху */
function buildDeltaWingGeometry(span: number, chord: number, halfThick: number): THREE.BufferGeometry {
  const hz = chord * 0.5;
  const hx = span * 0.5;
  const y = halfThick;
  const v = new Float32Array([
    0, y, hz,
    -hx, y, -hz,
    hx, y, -hz,
    0, -y, hz,
    -hx, -y, -hz,
    hx, -y, -hz,
  ]);
  const idx = [
    0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 0, 2, 5, 0, 5, 3, 1, 2, 5, 1, 5, 4,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildPlaneRiverRaidVis(state: GAME.State) {
  planeVis.length = 0;
  const V = PLANE_VIS_SCALE;
  disposePlaneDeltaWing(state);

  const span = 5.35 * S * V;
  const chord = 2.05 * S * V;
  const halfT = 0.055 * S * V;
  const wingGeo = buildDeltaWingGeometry(span, chord, halfT);
  const wingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(C.planeWing),
    side: THREE.DoubleSide,
    fog: true,
  });
  planeDeltaWingMesh = new THREE.Mesh(wingGeo, wingMat);
  planeDeltaWingMesh.renderOrder = 2;
  planeDeltaWingOx = 0;
  planeDeltaWingOy = 0.035 * V * S;
  planeDeltaWingOz = -0.08 * V * S;
  getRenderingContext(state).scene.add(planeDeltaWingMesh);

  const add = (
    ox: number,
    oy: number,
    oz: number,
    sx: number,
    sy: number,
    sz: number,
    color: string,
    yaw: number,
  ) => {
    const id = state.createFromRecipe('renderer', { shape: 'box', size: `${sx} ${sy} ${sz}`, color });
    Renderer.unlit[id] = 1;
    planeVis.push({ eid: id, ox: ox * S, oy: oy * S, oz: oz * S, yaw });
  };
  /* Узкий длинный фюзеляж над крылом (зазор по Y, не режет крыло) */
  add(0, 0.36 * V, 0, 0.74 * S * V, 0.48 * S * V, 5.05 * S * V, C.planeBody, 0);
  /* Тёмный нос — только впереди корпуса, без пересечения с белым */
  add(0, 0.36 * V, 3.08 * V, 0.36 * S * V, 0.36 * S * V, 1.0 * S * V, C.planeNose, 0);
  /* Стекло — сине-серое, чётко над верхом корпуса */
  add(0, 0.72 * V, 0.38 * V, 0.32 * S * V, 0.16 * S * V, 0.95 * S * V, C.planeCockpit, 0);
  /* ГО чуть выше крыла, ниже корпуса — без прохода через белый блок */
  add(0, 0.07 * V, -2.12 * V, 1.65 * S * V, 0.08 * S * V, 0.52 * S * V, C.planeWing, 0);
  /* Киль над крышкой фюзеляжа, нижний край выше белого — без мерцания */
  add(0, 0.92 * V, -2.18 * V, 0.1 * S * V, 0.55 * S * V, 0.46 * S * V, C.planeTail, 0);
}

function syncPlaneRiverRaidVis(state: GAME.State) {
  if (planeId < 0 || !state.exists(planeId)) return;
  const px = Body.posX[planeId];
  const py = Body.posY[planeId];
  const pz = Body.posZ[planeId];
  if (planeDeltaWingMesh) {
    planeDeltaWingMesh.position.set(px + planeDeltaWingOx, py + planeDeltaWingOy, pz + planeDeltaWingOz);
    planeDeltaWingMesh.rotation.y = 0;
  }
  for (const v of planeVis) {
    if (!state.exists(v.eid)) continue;
    Transform.posX[v.eid] = px + v.ox;
    Transform.posY[v.eid] = py + v.oy;
    Transform.posZ[v.eid] = pz + v.oz;
    Transform.eulerY[v.eid] = v.yaw;
  }
}

function destroyEntity(state: GAME.State, eid: number) {
  if (state.exists(eid)) state.destroyEntity(eid);
  enemyIds.delete(eid);
  missileIds.delete(eid);
  enemyKind.delete(eid);
}

function destroyBridge(state: GAME.State, b: Bridge) {
  if (b.destroyed) return;
  b.destroyed = true;
  for (const h of [b.pylL, b.pylR]) {
    hazardIds.delete(h);
    if (state.exists(h)) state.destroyEntity(h);
  }
  for (const v of b.vis) {
    if (state.exists(v)) state.destroyEntity(v);
  }
  b.vis.length = 0;
  checkpointZ = b.z;
}

function destroyDepotVisuals(state: GAME.State, d: FuelDepot) {
  for (const v of d.vis) {
    if (state.exists(v)) state.destroyEntity(v);
  }
  d.vis.length = 0;
  const sc = getScene(state);
  for (const m of d.meshes) {
    sc?.remove(m);
    m.geometry.dispose();
    const mat = m.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
  d.meshes.length = 0;
}

const FUEL_DEPOT_W_MUL = 1.5;
const FUEL_DEPOT_Z_MUL = 3;

/** Вдоль реки: сверху экрана (+Z) → вниз (−Z) читается FUEL; цвета красный / белый / красный / белый. */
const FUEL_SEGMENTS_ALONG_Z: { ch: string; bandRed: boolean }[] = [
  { ch: 'F', bandRed: true },
  { ch: 'U', bandRed: false },
  { ch: 'E', bandRed: true },
  { ch: 'L', bandRed: false },
];

function fuelLetterTexture(ch: string, bandRed: boolean, riverHex: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bandRed ? 'rgba(210, 45, 38, 0.48)' : 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size * 0.5, size * 0.5);
  ctx.rotate(Math.PI);
  ctx.fillStyle = riverHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 168px system-ui, \"Segoe UI\", sans-serif';
  ctx.fillText(ch, 0, 0);
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function addFuelDepotAlongRiver(state: GAME.State, cx: number, cz: number): THREE.Mesh[] {
  const rc = getRenderingContext(state);
  const bw = 2.8 * FUEL_DEPOT_W_MUL * S;
  const bl = 4.2 * FUEL_DEPOT_Z_MUL * S;
  const bh = 0.55 * S;
  const segZ = bl / 4;
  const deckY = -1.62 * S;
  const riverLetter = C.water;
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const { ch, bandRed } = FUEL_SEGMENTS_ALONG_Z[i]!;
    const map = fuelLetterTexture(ch, bandRed, riverLetter);
    const mat = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const geom = new THREE.BoxGeometry(bw, bh, segZ);
    const mesh = new THREE.Mesh(geom, mat);
    const zi = cz - bl * 0.5 + segZ * (3 - i + 0.5);
    mesh.position.set(cx, deckY, zi);
    mesh.userData.refuelBase = { x: cx, y: deckY, z: zi };
    mesh.renderOrder = 5;
    rc.scene.add(mesh);
    out.push(mesh);
  }
  return out;
}

function spawnRefuelRipple(state: GAME.State, cx: number, cz: number) {
  const rc = getRenderingContext(state);
  const waterY = -2.62 * S;
  const ring = new THREE.RingGeometry(0.32 * S, 0.5 * S, 56);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xb8e8ff,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(ring, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, waterY, cz);
  mesh.renderOrder = 4;
  rc.scene.add(mesh);
  refuelRipples.push({ mesh, t: 0 });
}

function updateRefuelRipples(state: GAME.State, dt: number) {
  const sc = getRenderingContext(state).scene;
  for (let i = refuelRipples.length - 1; i >= 0; i--) {
    const r = refuelRipples[i]!;
    r.t += dt * 1.05;
    const s = 1 + r.t * 3.4;
    r.mesh.scale.setScalar(s);
    const mat = r.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, 0.5 * (1 - r.t * 0.75));
    if (r.t > 1.2) {
      sc.remove(r.mesh);
      r.mesh.geometry.dispose();
      mat.dispose();
      refuelRipples.splice(i, 1);
    }
  }
}

function updateDepotRefuelShake(depot: FuelDepot, active: boolean, phase: number) {
  if (depot.destroyed) return;
  let idx = 0;
  for (const m of depot.meshes) {
    const b = m.userData.refuelBase as { x: number; y: number; z: number } | undefined;
    if (!b) {
      idx++;
      continue;
    }
    if (active) {
      const ph = phase + idx * 0.62;
      const ap = 0.11 * S;
      m.position.set(
        b.x + Math.sin(ph * 21) * ap,
        b.y + Math.sin(ph * 28 + 0.9) * ap * 0.42,
        b.z + Math.cos(ph * 17) * ap * 0.68,
      );
      m.rotation.x = Math.sin(ph * 35) * 0.038;
      m.rotation.z = Math.cos(ph * 24) * 0.048;
    } else {
      m.position.set(b.x, b.y, b.z);
      m.rotation.set(0, 0, 0);
    }
    idx++;
  }
}

function clearRefuelFx(state: GAME.State) {
  const sc = getRenderingContext(state).scene;
  for (const r of refuelRipples) {
    sc.remove(r.mesh);
    r.mesh.geometry.dispose();
    (r.mesh.material as THREE.MeshBasicMaterial).dispose();
  }
  refuelRipples.length = 0;
  refuelRippleSpawnAcc = 0;
  refuelShakePhase = 0;
  for (const d of depots) updateDepotRefuelShake(d, false, 0);
}

function showGameEndOverlay(kind: 'continue' | 'game_over') {
  const ov = document.getElementById('game-end-overlay');
  const title = document.getElementById('game-end-title');
  const msg = document.getElementById('game-end-msg');
  const btn = document.getElementById('game-end-btn');
  if (!ov || !title || !msg || !btn) return;
  if (kind === 'continue') {
    title.textContent = 'Джет потерян';
    msg.textContent = `Осталось машин: ${jetsLeft}. Продолжить с последнего чекпоинта (мост)?`;
    btn.textContent = 'Продолжить';
  } else {
    title.textContent = 'Игра окончена';
    msg.textContent = 'Самолёты закончились. Начать уровень сначала — сброс очков и прогресса.';
    btn.textContent = 'Начать сначала';
  }
  ov.classList.add('is-visible');
  btn.focus();
}

function hideGameEndOverlay() {
  document.getElementById('game-end-overlay')?.classList.remove('is-visible');
}

function resetJetsAndProgress(state: GAME.State) {
  for (const m of [...missileIds]) destroyEntity(state, m);
  for (const e of [...enemyIds]) destroyEntity(state, e);
  missileIds.clear();
  enemyIds.clear();
  enemyKind.clear();
  shootCooldownLeft = 0;
  enemySpawnTimer = 1.2;
  score = 0;
  fuel = 100;
  jetsLeft = 3;
  checkpointZ = 0;
  extraLifeMilestone = 0;
  shootCooldownLeft = 0;
  for (const d of depots) {
    d.destroyed = false;
    /* визуалы не пересоздаём при полном сбросе — сессия та же; депо остаётся «срубленным» по визуалу */
  }
  clearRefuelFx(state);
  if (planeId >= 0 && state.exists(planeId)) {
    Body.posX[planeId] = riverCenterXAt(0);
    Body.posY[planeId] = 4.8 * S;
    Body.posZ[planeId] = 0;
    Body.velX[planeId] = 0;
    Body.velY[planeId] = 0;
    Body.velZ[planeId] = 0;
  }
}

function respawnAtCheckpoint(state: GAME.State) {
  for (const m of [...missileIds]) destroyEntity(state, m);
  for (const e of [...enemyIds]) destroyEntity(state, e);
  missileIds.clear();
  enemyIds.clear();
  enemyKind.clear();
  shootCooldownLeft = 0;
  enemySpawnTimer = 1.2;
  fuel = 100;
  if (planeId >= 0 && state.exists(planeId)) {
    const rz = checkpointZ + 8 * S;
    Body.posX[planeId] = riverCenterXAt(rz);
    Body.posY[planeId] = 4.8 * S;
    Body.posZ[planeId] = rz;
    Body.velX[planeId] = 0;
    Body.velY[planeId] = 0;
    Body.velZ[planeId] = 0;
  }
}

function die(state: GAME.State) {
  if (runState !== 'playing') return;
  jetsLeft -= 1;
  if (planeId >= 0 && state.exists(planeId)) {
    state.addComponent(planeId, SetLinearVelocity, { x: 0, y: 0, z: 0 });
  }
  for (const eid of enemyIds) {
    if (state.exists(eid)) state.addComponent(eid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
  }
  for (const mid of missileIds) {
    if (state.exists(mid)) state.addComponent(mid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
  }
  if (jetsLeft <= 0) {
    runState = 'paused_game_over';
    showGameEndOverlay('game_over');
    return;
  }
  runState = 'paused_continue';
  showGameEndOverlay('continue');
}

function addScore(points: number) {
  score += points;
  const m = Math.floor(score / 10000);
  while (extraLifeMilestone < m) {
    extraLifeMilestone += 1;
    if (jetsLeft < 9) jetsLeft += 1;
  }
}

/** Как у широкой баржи: половина по X/Z + запас. */
const DEPOT_RX = 2.2 * FUEL_DEPOT_W_MUL * S;
const DEPOT_RZ = 3.2 * FUEL_DEPOT_Z_MUL * S;
const BRIDGE_HALF_HIT = 0.52;
const BRIDGE_KILL_Z = 2.4 * S;
const MISSILE_HIT_R = 1.85 * S;

function updateHud(pz: number, lowFuel: boolean) {
  const sEl = document.getElementById('hud-score');
  const fEl = document.getElementById('hud-fuel');
  const dEl = document.getElementById('hud-dist');
  const lEl = document.getElementById('hud-lives');
  const wrap = document.getElementById('hud-wrap');
  if (sEl) sEl.textContent = String(Math.floor(score)).padStart(6, '0');
  if (dEl) dEl.textContent = String(Math.floor(pz / S)).padStart(5, '0');
  if (lEl) lEl.textContent = String(Math.max(0, jetsLeft));
  if (fEl) {
    const n = Math.max(0, Math.min(12, Math.round((fuel / 100) * 12)));
    fEl.textContent = '█'.repeat(n) + '░'.repeat(12 - n);
    fEl.style.color = lowFuel ? '#ffb030' : '#fff';
  }
  if (wrap) wrap.style.background = lowFuel ? 'rgba(80, 20, 0, 0.82)' : 'rgba(0, 30, 60, 0.75)';
}

function tryMissileWorldHits(state: GAME.State) {
  for (const mid of [...missileIds]) {
    if (!state.exists(mid)) {
      missileIds.delete(mid);
      continue;
    }
    const mx = Body.posX[mid];
    const mz = Body.posZ[mid];
    let removed = false;

    for (const b of bridges) {
      if (b.destroyed) continue;
      const hw = riverHalfAt(b.z) * BRIDGE_HALF_HIT;
      const rcx = riverCenterXAt(b.z);
      if (Math.abs(mz - b.z) < BRIDGE_KILL_Z && Math.abs(mx - rcx) < hw) {
        addScore(SCORE_BRIDGE);
        destroyEntity(state, mid);
        destroyBridge(state, b);
        removed = true;
        break;
      }
    }
    if (removed) continue;

    for (const d of depots) {
      if (d.destroyed) continue;
      if (Math.abs(mx - d.cx) < MISSILE_HIT_R && Math.abs(mz - d.cz) < MISSILE_HIT_R) {
        d.destroyed = true;
        addScore(SCORE_DEPOT);
        destroyDepotVisuals(state, d);
        destroyEntity(state, mid);
        removed = true;
        break;
      }
    }
  }
}

function buildLevel(state: GAME.State) {
  const waterLen = Z_SEG_END - Z_SEG_START + 400 * S;
  const waterCenterZ = (Z_SEG_START + Z_SEG_END) * 0.5;
  const waterW = COAST_WORLD_HALF * 2 + 12 * S;

  const water = state.createFromRecipe('static-part', {
    pos: `0 ${-2.85 * S} ${waterCenterZ}`,
    shape: 'box',
    size: `${waterW} ${0.48 * S} ${waterLen}`,
    color: C.water,
  });
  hazardIds.add(water);
  state.addComponent(water, CollisionEvents, { activeEvents: 1 });

  const fadeW = COAST_FADE_BAND / COAST_FADE_SLICES;

  for (let z = Z_SEG_START; z < Z_SEG_END; z += BANK_SLICE) {
    const zc = z + BANK_SLICE * 0.5;
    const half = riverHalfAt(zc);
    const rcx = riverCenterXAt(zc);
    const hBase = (4.85 + Math.sin(zc * 0.0035) * 1.25) * S;
    const sliceLen = BANK_SLICE * 1.06;

    const innerL = rcx - half - WATER_BANK_INSET;
    const innerR = rcx + half + WATER_BANK_INSET;
    const wLeft = innerL - -COAST_OUTER;
    const wRight = COAST_OUTER - innerR;
    const cLeft = (-COAST_OUTER + innerL) * 0.5;
    const cRight = (innerR + COAST_OUTER) * 0.5;

    const lo = state.createFromRecipe('static-part', {
      pos: `${cLeft} ${hBase * 0.42 - 1.1 * S} ${zc}`,
      shape: 'box',
      size: `${wLeft} ${hBase * 0.78 + 1.4 * S} ${sliceLen}`,
      color: C.bankGrass,
    });
    hazardIds.add(lo);
    state.addComponent(lo, CollisionEvents, { activeEvents: 1 });

    const l1w = wLeft * 0.78 + 2.2 * S;
    const l1 = state.createFromRecipe('static-part', {
      pos: `${cLeft - 0.55 * S} ${hBase * 0.88 + 0.15 * S} ${zc}`,
      shape: 'box',
      size: `${Math.min(l1w, wLeft + 1.5 * S)} ${hBase * 0.48 + 0.85 * S} ${sliceLen * 0.96}`,
      color: C.bankMeadow,
    });
    hazardIds.add(l1);
    state.addComponent(l1, CollisionEvents, { activeEvents: 1 });

    const l2 = state.createFromRecipe('static-part', {
      pos: `${cLeft - 0.95 * S} ${hBase * 1.12 + 0.85 * S} ${zc}`,
      shape: 'box',
      size: `${wLeft * 0.52 + 1.6 * S} ${1.45 * S} ${sliceLen * 0.92}`,
      color: C.bankSand,
    });
    hazardIds.add(l2);
    state.addComponent(l2, CollisionEvents, { activeEvents: 1 });

    const cPadL = -(COAST_WORLD_HALF + COAST_OUTER) * 0.5;
    const lext = state.createFromRecipe('static-part', {
      pos: `${cPadL} ${hBase * 0.42 - 1.1 * S} ${zc}`,
      shape: 'box',
      size: `${COAST_PAD_OUTER} ${hBase * 0.78 + 1.4 * S} ${sliceLen}`,
      color: C.bankGrass,
    });
    hazardIds.add(lext);
    state.addComponent(lext, CollisionEvents, { activeEvents: 1 });

    const ro = state.createFromRecipe('static-part', {
      pos: `${cRight} ${hBase * 0.42 - 1.1 * S} ${zc}`,
      shape: 'box',
      size: `${wRight} ${hBase * 0.78 + 1.4 * S} ${sliceLen}`,
      color: C.bankGrass,
    });
    hazardIds.add(ro);
    state.addComponent(ro, CollisionEvents, { activeEvents: 1 });

    const r1w = wRight * 0.78 + 2.2 * S;
    const r1 = state.createFromRecipe('static-part', {
      pos: `${cRight + 0.55 * S} ${hBase * 0.88 + 0.15 * S} ${zc}`,
      shape: 'box',
      size: `${Math.min(r1w, wRight + 1.5 * S)} ${hBase * 0.48 + 0.85 * S} ${sliceLen * 0.96}`,
      color: C.bankMeadow,
    });
    hazardIds.add(r1);
    state.addComponent(r1, CollisionEvents, { activeEvents: 1 });

    const r2 = state.createFromRecipe('static-part', {
      pos: `${cRight + 0.95 * S} ${hBase * 1.12 + 0.85 * S} ${zc}`,
      shape: 'box',
      size: `${wRight * 0.52 + 1.6 * S} ${1.45 * S} ${sliceLen * 0.92}`,
      color: C.bankSand,
    });
    hazardIds.add(r2);
    state.addComponent(r2, CollisionEvents, { activeEvents: 1 });

    const cPadR = (COAST_WORLD_HALF + COAST_OUTER) * 0.5;
    const rext = state.createFromRecipe('static-part', {
      pos: `${cPadR} ${hBase * 0.42 - 1.1 * S} ${zc}`,
      shape: 'box',
      size: `${COAST_PAD_OUTER} ${hBase * 0.78 + 1.4 * S} ${sliceLen}`,
      color: C.bankGrass,
    });
    hazardIds.add(rext);
    state.addComponent(rext, CollisionEvents, { activeEvents: 1 });

    const grassY = hBase * 0.42 - 1.1 * S;
    const grassH = hBase * 0.78 + 1.4 * S;
    const groundTop = grassY + grassH * 0.5;
    const hFade = hBase * 0.55 + 1.1 * S;
    const yFade = groundTop + 0.35 * S + hFade * 0.5;
    const meadowC = hexToLinearColor(C.bankMeadow);
    const skyC = hexToLinearColor(SKY_MIST);
    for (let fi = 0; fi < COAST_FADE_SLICES; fi++) {
      const ft = fi / Math.max(1, COAST_FADE_SLICES - 1);
      const col = meadowC.clone().lerp(skyC, ft * 0.9);
      const opacity = 0.07 + ft * 0.74;
      const xl = -COAST_OUTER + (fi + 0.5) * fadeW;
      addCoastMistStrip(state, xl, yFade, zc, fadeW * 1.08, hFade, sliceLen, col, opacity);
      const xr = COAST_OUTER - (fi + 0.5) * fadeW;
      addCoastMistStrip(state, xr, yFade, zc, fadeW * 1.08, hFade, sliceLen, col, opacity);
    }

    for (let t = 0; t < 3; t++) {
      const tz = zc + (t - 1) * (BANK_SLICE * 0.28);
      const tx = innerL - 7 * S - t * 2.5 * S;
      const tr = state.createFromRecipe('renderer', {
        shape: 'box',
        size: `${0.35 * S} ${(1.8 + t * 0.45) * S} ${0.35 * S}`,
        color: C.tree,
      });
      Transform.posX[tr] = tx;
      Transform.posY[tr] = hBase * 1.12 + 0.85 * S + 0.7 * S + t * 0.2 * S;
      Transform.posZ[tr] = tz;
    }
    for (let t = 0; t < 3; t++) {
      const tz = zc + (t - 1) * (BANK_SLICE * 0.28);
      const tx = innerR + 7 * S + t * 2.5 * S;
      const tr = state.createFromRecipe('renderer', {
        shape: 'box',
        size: `${0.35 * S} ${(1.8 + t * 0.45) * S} ${0.35 * S}`,
        color: C.tree,
      });
      Transform.posX[tr] = tx;
      Transform.posY[tr] = hBase * 1.12 + 0.85 * S + 0.7 * S + t * 0.2 * S;
      Transform.posZ[tr] = tz;
    }
  }

  for (let z = Z_SEG_START + 35 * S; z < Z_SEG_END; z += 44 * S) {
    const m = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.22 * S} ${6.8 * S} ${0.22 * S}`,
      color: C.channelMark,
    });
    Transform.posX[m] = riverCenterXAt(z);
    Transform.posY[m] = -1.05 * S;
    Transform.posZ[m] = z;
  }

  for (let z = Z_SEG_START + 72 * S; z < Z_SEG_END; z += 200 * S) {
    const half = riverHalfAt(z);
    const bcx = riverCenterXAt(z);
    const span = half * 2 + 1.8 * S;
    const deck = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${span} ${0.55 * S} ${3.6 * S}`,
      color: C.bridgeWood,
    });
    Transform.posX[deck] = bcx;
    Transform.posY[deck] = 11.5 * S;
    Transform.posZ[deck] = z;
    const railL = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.22 * S} ${0.4 * S} ${3.7 * S}`,
      color: C.bridgeRail,
    });
    Transform.posX[railL] = bcx - span * 0.5 + 0.2 * S;
    Transform.posY[railL] = 11.85 * S;
    Transform.posZ[railL] = z;
    const railR = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.22 * S} ${0.4 * S} ${3.7 * S}`,
      color: C.bridgeRail,
    });
    Transform.posX[railR] = bcx + span * 0.5 - 0.2 * S;
    Transform.posY[railR] = 11.85 * S;
    Transform.posZ[railR] = z;

    const pylH = 14 * S;
    const pylW = 1.25 * S;
    const pylGap = 2.85 * S;
    const pylL = state.createFromRecipe('static-part', {
      pos: `${bcx - (half + pylGap)} ${-0.2 * S} ${z}`,
      shape: 'box',
      size: `${pylW} ${pylH} ${2.8 * S}`,
      color: C.bridgeWood,
    });
    hazardIds.add(pylL);
    state.addComponent(pylL, CollisionEvents, { activeEvents: 1 });
    const pylR = state.createFromRecipe('static-part', {
      pos: `${bcx + half + pylGap} ${-0.2 * S} ${z}`,
      shape: 'box',
      size: `${pylW} ${pylH} ${2.8 * S}`,
      color: C.bridgeWood,
    });
    hazardIds.add(pylR);
    state.addComponent(pylR, CollisionEvents, { activeEvents: 1 });

    bridges.push({ z, destroyed: false, pylL, pylR, vis: [deck, railL, railR] });
  }

  for (let z = Z_SEG_START + 55 * S; z < Z_SEG_END; z += 92 * S) {
    const half = riverHalfAt(z);
    const dcx = riverCenterXAt(z);
    const lane = (Math.sin(z * 0.11) * 0.55 + Math.sin(z * 0.037) * 0.35) * half * 0.82;
    const key = `dep-${Math.round(z * 10)}`;
    const cx = dcx + lane;
    const fuelMeshes = addFuelDepotAlongRiver(state, cx, z);

    depots.push({
      cx,
      cz: z,
      key,
      destroyed: false,
      vis: [],
      meshes: fuelMeshes,
    });
  }

  planeId = state.createFromRecipe('kinematic-part', {
    pos: `${riverCenterXAt(0)} ${4.8 * S} 0`,
    shape: 'box',
    size: `${2.9 * S} ${0.84 * S} ${5.4 * S}`,
    color: C.planeBody,
  });
  Renderer.visible[planeId] = 0;
  state.addComponent(planeId, InputState);
  state.addComponent(planeId, CollisionEvents, { activeEvents: 1 });
  buildPlaneRiverRaidVis(state);

  const cam = state.createFromRecipe('orbit-camera', {
    'target-distance': `${CAM_DIST}`,
    'target-pitch': String(CAM_PITCH),
    'offset-y': `${1.45 * S}`,
    smoothness: '1',
  });
  cameraId = cam;
  OrbitCamera.target[cam] = planeId;
  OrbitCamera.inputSource[cam] = planeId;
  OrbitCamera.targetYaw[cam] = CAM_YAW;
  OrbitCamera.currentYaw[cam] = CAM_YAW;
  OrbitCamera.targetPitch[cam] = CAM_PITCH;
  OrbitCamera.currentPitch[cam] = CAM_PITCH;
  OrbitCamera.targetDistance[cam] = CAM_DIST;
  OrbitCamera.currentDistance[cam] = CAM_DIST;
  OrbitCamera.sensitivity[cam] = 0;
  OrbitCamera.zoomSensitivity[cam] = 0;

  for (let i = 0; i < FLOW_COUNT; i++) {
    const f = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.13 * S} ${0.02 * S} ${2.4 * S}`,
      color: C.wake,
    });
    Transform.posX[f] = (i % 2 === 0 ? -1 : 1) * (0.9 + (i % 6) * 0.45) * S;
    Transform.posY[f] = -0.52 * S;
    Transform.posZ[f] = (-10 + i * 3.6) * S;
    flowIds.push(f);
  }
}

const physicsWorldQuery = GAME.defineQuery([PhysicsWorld]);
const touchedQuery = GAME.defineQuery([TouchedEvent]);
const renderContextQuery = GAME.defineQuery([RenderContext]);

const InitRuntime: GAME.System = {
  setup: (state) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
    const ctxEnt = renderContextQuery(state.world)[0];
    if (canvas && ctxEnt !== undefined) setCanvasElement(ctxEnt, canvas);
  },
};

const FlightFixed: GAME.System = {
  group: 'fixed',
  first: true,
  update: (state) => {
    const pw = physicsWorldQuery(state.world)[0];
    if (pw === undefined) return;

    if (!initialized) {
      PhysicsWorld.gravityX[pw] = 0;
      PhysicsWorld.gravityY[pw] = 0;
      PhysicsWorld.gravityZ[pw] = 0;
      buildLevel(state);
      initialized = true;
    }

    if (planeId < 0 || !state.exists(planeId)) return;

    if (runState !== 'playing') {
      state.addComponent(planeId, SetLinearVelocity, { x: 0, y: 0, z: 0 });
      syncPlaneRiverRaidVis(state);
      for (const eid of enemyIds) {
        if (!state.exists(eid)) continue;
        state.addComponent(eid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
      }
      for (const mid of missileIds) {
        if (!state.exists(mid)) continue;
        state.addComponent(mid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
      }
      return;
    }

    const mx = InputState.moveX[planeId] ?? 0;
    const my = InputState.moveY[planeId] ?? 0;
    /* W / стрелка вверх — ускорение вперёд, S / вниз — замедление (как джойстик RR) */
    const speedMul = Math.max(0.28, Math.min(1.18, 0.78 + my * 0.32));
    const forward = BASE_FORWARD * speedMul;

    /* Камера сзади по +Z: инверсия как у «джойстика вверх» в оригинале на ПК */
    let vx = -mx * STRAFE_SPEED;
    const px = Body.posX[planeId];
    const pz = Body.posZ[planeId];
    const half = riverHalfAt(pz);
    const rcx = riverCenterXAt(pz);
    const planeXMin = rcx - half + 2.85 * S;
    const planeXMax = rcx + half - 2.85 * S;
    if (px <= planeXMin && vx < 0) vx = 0;
    if (px >= planeXMax && vx > 0) vx = 0;

    state.addComponent(planeId, SetLinearVelocity, {
      x: vx,
      y: 0,
      z: FZ * forward,
    });

    syncPlaneRiverRaidVis(state);

    for (const eid of enemyIds) {
      if (!state.exists(eid)) continue;
      const k = enemyKind.get(eid);
      const sp = k === 'ship' ? ENEMY_SHIP_SPEED : k === 'jet' ? ENEMY_JET_SPEED : ENEMY_HELO_SPEED;
      state.addComponent(eid, SetLinearVelocity, { x: 0, y: 0, z: -FZ * sp });
    }
    for (const mid of missileIds) {
      if (!state.exists(mid)) continue;
      state.addComponent(mid, SetLinearVelocity, { x: 0, y: 0, z: FZ * MISSILE_SPEED });
    }
  },
};

const GameplaySim: GAME.System = {
  group: 'simulation',
  last: true,
  update: (state) => {
    if (!initialized || planeId < 0) return;
    uiStateRef = state;
    applyRiverHorizonAtmosphere(state);
    const dt = state.time.deltaTime;
    const pz = Body.posZ[planeId];
    const px = Body.posX[planeId];

    if (runState !== 'playing') {
      for (const d of depots) updateDepotRefuelShake(d, false, 0);
      if (cameraId >= 0 && state.exists(cameraId)) {
        OrbitCamera.targetYaw[cameraId] = CAM_YAW;
        OrbitCamera.currentYaw[cameraId] = CAM_YAW;
        OrbitCamera.targetPitch[cameraId] = CAM_PITCH;
        OrbitCamera.currentPitch[cameraId] = CAM_PITCH;
        OrbitCamera.targetDistance[cameraId] = CAM_DIST;
        OrbitCamera.currentDistance[cameraId] = CAM_DIST;
        OrbitCamera.sensitivity[cameraId] = 0;
        OrbitCamera.zoomSensitivity[cameraId] = 0;
      }
      updateHud(pz, fuel < 26);
      updateRefuelRipples(state, dt);
      return;
    }

    if (cameraId >= 0 && state.exists(cameraId)) {
      OrbitCamera.targetYaw[cameraId] = CAM_YAW;
      OrbitCamera.currentYaw[cameraId] = CAM_YAW;
      OrbitCamera.targetPitch[cameraId] = CAM_PITCH;
      OrbitCamera.currentPitch[cameraId] = CAM_PITCH;
      OrbitCamera.targetDistance[cameraId] = CAM_DIST;
      OrbitCamera.currentDistance[cameraId] = CAM_DIST;
      OrbitCamera.sensitivity[cameraId] = 0;
      OrbitCamera.zoomSensitivity[cameraId] = 0;
    }

    fuel -= dt * 2.65;
    const lowFuel = fuel < 26;
    if (fuel <= 0) {
      fuel = 0;
      die(state);
    }

    let refuelRippleAt: { cx: number; cz: number } | null = null;
    for (const d of depots) {
      if (d.destroyed) continue;
      if (Math.abs(px - d.cx) < DEPOT_RX && Math.abs(pz - d.cz) < DEPOT_RZ) {
        fuel = Math.min(100, fuel + dt * 42);
        refuelRippleAt = { cx: d.cx, cz: d.cz };
      }
    }
    if (refuelRippleAt) {
      refuelShakePhase += dt;
      refuelRippleSpawnAcc += dt;
      if (refuelRippleSpawnAcc >= 0.11) {
        refuelRippleSpawnAcc = 0;
        spawnRefuelRipple(state, refuelRippleAt.cx, refuelRippleAt.cz);
      }
    } else {
      refuelRippleSpawnAcc = 0;
    }
    for (const d of depots) {
      const near =
        !d.destroyed && Math.abs(px - d.cx) < DEPOT_RX && Math.abs(pz - d.cz) < DEPOT_RZ;
      updateDepotRefuelShake(d, near, refuelShakePhase);
    }
    updateRefuelRipples(state, dt);

    updateHud(pz, lowFuel);
    tryMissileWorldHits(state);

    shootCooldownLeft = Math.max(0, shootCooldownLeft - dt);
    if (consumePrimary() && shootCooldownLeft <= 0) {
      shootCooldownLeft = SHOOT_COOLDOWN;
      const x = Body.posX[planeId];
      const y = Body.posY[planeId];
      const z = Body.posZ[planeId];
      const nose = 3.62 * S * PLANE_VIS_SCALE;
      const m = state.createFromRecipe('kinematic-part', {
        pos: `${x} ${y} ${z + FZ * nose}`,
        shape: 'sphere',
        size: `${0.38 * S}`,
        color: C.bullet,
      });
      state.addComponent(m, CollisionEvents, { activeEvents: 1 });
      missileIds.add(m);
    }

    enemySpawnTimer -= dt;
    if (enemySpawnTimer <= 0) {
      enemySpawnTimer = ENEMY_SPAWN_EVERY;
      const ezPred = pz + FZ * 55 * S;
      const half = riverHalfAt(ezPred);
      const ecx = riverCenterXAt(ezPred);
      const rx = ecx + (Math.random() - 0.5) * (half * 1.65);
      const ex = Math.min(ecx + half - 2.85 * S, Math.max(ecx - half + 2.85 * S, rx));
      const ez = pz + FZ * (46 * S + Math.random() * 14 * S);
      const roll = Math.random();
      const kind: EnemyKind = roll < 0.38 ? 'ship' : roll < 0.72 ? 'helo' : 'jet';
      const isShip = kind === 'ship';
      const ey = isShip ? -1.55 * S : kind === 'jet' ? Body.posY[planeId] + 1.1 * S + Math.random() * 0.6 * S : Body.posY[planeId] + (Math.random() - 0.5) * 0.5 * S;
      const col = kind === 'ship' ? C.enemyShip : kind === 'jet' ? C.enemyJet : C.enemyHelo;
      const sx = isShip ? 2.5 * S : kind === 'jet' ? 1.65 * S : 1.85 * S;
      const sy = isShip ? 0.38 * S : kind === 'jet' ? 0.42 * S : 0.48 * S;
      const sz = isShip ? 3.5 * S : kind === 'jet' ? 2.15 * S : 2 * S;
      const en = state.createFromRecipe('kinematic-part', {
        pos: `${ex} ${ey} ${ez}`,
        shape: 'box',
        size: `${sx} ${sy} ${sz}`,
        color: col,
      });
      state.addComponent(en, CollisionEvents, { activeEvents: 1 });
      enemyIds.add(en);
      enemyKind.set(en, kind);
    }

    const strip = BASE_FORWARD * dt;
    for (const fid of flowIds) {
      if (!state.exists(fid)) continue;
      Transform.posZ[fid] -= strip * 0.88 * FZ;
      if (Transform.posZ[fid] < pz - 42 * S) Transform.posZ[fid] = pz + 34 * S + Math.random() * 8 * S;
    }

    for (const mid of [...missileIds]) {
      if (!state.exists(mid)) {
        missileIds.delete(mid);
        continue;
      }
      const along = FZ * (Body.posZ[mid] - pz);
      if (along > 130 * S) destroyEntity(state, mid);
    }
    for (const eid of [...enemyIds]) {
      if (!state.exists(eid)) {
        enemyIds.delete(eid);
        continue;
      }
      const along = FZ * (Body.posZ[eid] - pz);
      if (along < -45 * S) destroyEntity(state, eid);
    }

    for (const eid of touchedQuery(state.world)) {
      const other = TouchedEvent.other[eid] as number;

      if (eid === planeId && hazardIds.has(other)) {
        die(state);
        continue;
      }
      if (other === planeId && hazardIds.has(eid)) {
        die(state);
        continue;
      }

      if (eid === planeId && enemyIds.has(other)) {
        die(state);
        continue;
      }
      if (other === planeId && enemyIds.has(eid)) {
        die(state);
        continue;
      }

      if (missileIds.has(eid) && enemyIds.has(other)) {
        const k = enemyKind.get(other);
        addScore(k === 'ship' ? SCORE_SHIP : k === 'jet' ? SCORE_JET : SCORE_HELO);
        fuel = Math.min(100, fuel + 6);
        destroyEntity(state, eid);
        destroyEntity(state, other);
        continue;
      }
      if (missileIds.has(other) && enemyIds.has(eid)) {
        const k = enemyKind.get(eid);
        addScore(k === 'ship' ? SCORE_SHIP : k === 'jet' ? SCORE_JET : SCORE_HELO);
        fuel = Math.min(100, fuel + 6);
        destroyEntity(state, other);
        destroyEntity(state, eid);
        continue;
      }

      if (missileIds.has(eid) && hazardIds.has(other)) destroyEntity(state, eid);
      if (missileIds.has(other) && hazardIds.has(eid)) destroyEntity(state, other);
    }
  },
};

const plugins = DefaultPlugins.filter(
  (p) => p !== PlayerPlugin && p !== StartupPlugin && p !== RespawnPlugin,
);

GAME.withoutDefaultPlugins();
for (const p of plugins) GAME.withPlugin(p);
GAME.withSystem(InitRuntime);
GAME.withSystem(FlightFixed);
GAME.withSystem(GameplaySim);

document.getElementById('game-end-btn')?.addEventListener('click', () => {
  const st = uiStateRef;
  if (!st || runState === 'playing') return;
  if (runState === 'paused_continue') {
    runState = 'playing';
    hideGameEndOverlay();
    respawnAtCheckpoint(st);
  } else if (runState === 'paused_game_over') {
    runState = 'playing';
    hideGameEndOverlay();
    resetJetsAndProgress(st);
  }
});

void GAME.run();
