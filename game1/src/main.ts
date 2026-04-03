import * as THREE from 'three';
import * as GAME from 'vibegame';
import { DefaultPlugins } from 'vibegame/defaults';
import { PlayerPlugin } from 'vibegame/player';
import { StartupPlugin } from 'vibegame/startup';
import { RespawnPlugin } from 'vibegame/respawn';
import { PhysicsWorld, Body, CollisionEvents, TouchedEvent, SetLinearVelocity } from 'vibegame/physics';
import { InputPlugin, InputState, consumePrimary, INPUT_CONFIG } from 'vibegame/input';
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
  bullet: '#ffee00',
  foeRedWing: '#e01818',
  foePurpleWing: '#a048f0',
  hostileMissile: '#c838ff',
  bridgeWood: '#704028',
  bridgeRail: '#5a3418',
  tree: '#1a6a12',
} as const;

/** Очки как в мануалах/стратегиях River Raid */
const SCORE_DEPOT = 80;
const SCORE_BRIDGE = 500;
const SCORE_FOE_RED = 100;
const SCORE_FOE_PURPLE = Math.round(SCORE_FOE_RED * 2.5);

/** Общий множитель скорости игрока, врагов (сближение), ракет. */
const SPEED_MUL = 1.15;
const BASE_FORWARD = 20 * S * SPEED_MUL;
/** Типичный множитель газа (середина диапазона) — для баланса топлива между заправками. */
const TYPICAL_FORWARD_MUL = 0.88;
const STRAFE_SPEED = 12 * S * 1.85 * SPEED_MUL;
const MISSILE_SPEED = 58 * S * SPEED_MUL;
const HOSTILE_MISSILE_SPEED = 54 * S * SPEED_MUL;
/** Реже спавн — не скапливаются вплотную по времени. */
/** Интервал спавна; +30% чаще ⇒ делим базовый период на 1.3. */
const ENEMY_SPAWN_EVERY = 4.15 / 1.3;
/** Враг впереди по +Z: намного дальше по реке от игрока. */
const ENEMY_SPAWN_AHEAD_MIN = 168 * S;
const ENEMY_SPAWN_AHEAD_SPREAD = 48 * S;
/** Ширина русла — в районе фактического Z врага. */
const ENEMY_SPAWN_RIVER_SAMPLE_AHEAD = 195 * S;

const RIVER_WIDE = 6;
const RIVER_HALF_MAX = 7.4 * S * RIVER_WIDE;
/** Масштаб «запаса» суши за пределами макс. половины русла. */
const BANK_LAND_MUL = 2.15;
const FZ = 1;

/** Заправки в 2× реже по реке (шаг по Z между ними). */
const FUEL_DEPOT_Z_STEP = 184 * S;
/**
 * Баланс: можно пропустить ровно одну из трёх заправок (два участка подряд без дозаправки).
 * При |velZ| ≈ BASE_FORWARD·TYPICAL_FORWARD_MUL расход даёт ~FUEL_BALANCE_RESERVE_PCT % к следующей заправке.
 */
const FUEL_BALANCE_RESERVE_PCT = 12;
const FUEL_DRAIN_PER_SEC =
  (100 - FUEL_BALANCE_RESERVE_PCT) /
  ((2 * FUEL_DEPOT_Z_STEP) / (BASE_FORWARD * TYPICAL_FORWARD_MUL));

const Z_SEG_START = -150 * S;
const Z_SEG_END = 3200 * S;
/** Тонкие срезы вдоль течения. */
const BANK_SLICE = 6.5 * S;
const WATER_BANK_INSET = 1.35 * S;
/** Половина ширины коллайдера джета по X (recipe `kinematic-part` size 2.9×…×5.4). */
const PLANE_HITBOX_HALF_X = 1.45 * S;
/** Половины бокса коллайдера = у spawn; kinematic↔kinematic в Rapier DEFAULT не детектится. */
const PLANE_COLL_HALF = { x: 1.45 * S, y: 0.42 * S, z: 2.7 * S } as const;
/** Коллайдеры = половины size из spawn (красный 5.8×1.68×10.8, фиолет 2.9×0.84×5.4). */
const FOE_RED_COLL_HALF = { x: 2.9 * S, y: 0.84 * S, z: 5.4 * S } as const;
const FOE_PURP_COLL_HALF = { x: 1.45 * S, y: 0.42 * S, z: 2.7 * S } as const;
const HOSTILE_MISSILE_COLL_HALF = { x: 0.17 * S, y: 0.17 * S, z: 0.69 * S } as const;
const PLAYER_MISSILE_HALF = { x: 0.26 * S, y: 0.26 * S, z: 1.25 * S } as const;

function aabbOverlap(
  ax: number,
  ay: number,
  az: number,
  ahx: number,
  ahy: number,
  ahz: number,
  bx: number,
  by: number,
  bz: number,
  bhx: number,
  bhy: number,
  bhz: number,
): boolean {
  return (
    Math.abs(ax - bx) < ahx + bhx &&
    Math.abs(ay - by) < ahy + bhy &&
    Math.abs(az - bz) < ahz + bhz
  );
}

/** Вражеская ракета + джет: высокая сходимость по Z — дискретный AABB может «пролетать»; запас по шагу и осям. */
function planeOverlapsHostileMissile(state: GAME.State, hid: number): boolean {
  if (planeId < 0 || !state.exists(planeId) || !state.exists(hid)) return false;
  const ax = Body.posX[planeId];
  const ay = Body.posY[planeId];
  const az = Body.posZ[planeId];
  const bx = Body.posX[hid];
  const by = Body.posY[hid];
  const bz = Body.posZ[hid];
  const ph = PLANE_COLL_HALF;
  const h = HOSTILE_MISSILE_COLL_HALF;
  const pvz = Body.velZ[planeId];
  const mvz = Body.velZ[hid];
  const step = Math.max(state.time.deltaTime, state.time.fixedDeltaTime);
  const zSlack = Math.abs(pvz - mvz) * step + 3.5 * S;
  const xySlack = 0.5 * S;
  return (
    Math.abs(ax - bx) < ph.x + h.x + xySlack &&
    Math.abs(ay - by) < ph.y + h.y + xySlack &&
    Math.abs(az - bz) < ph.z + h.z + zSlack
  );
}

/** Столкновение джета с врагами / их ракетами (движок не шлёт TouchedEvent kinematic–kinematic). */
function tryPlaneVsFoesAndHostileMissiles(state: GAME.State): boolean {
  if (planeId < 0 || !state.exists(planeId)) return false;
  const ax = Body.posX[planeId];
  const ay = Body.posY[planeId];
  const az = Body.posZ[planeId];
  const ph = PLANE_COLL_HALF;
  for (const eid of enemyIds) {
    if (!state.exists(eid)) continue;
    const k = enemyKind.get(eid);
    const h = k === 'foePurple' ? FOE_PURP_COLL_HALF : FOE_RED_COLL_HALF;
    if (
      aabbOverlap(ax, ay, az, ph.x, ph.y, ph.z, Body.posX[eid], Body.posY[eid], Body.posZ[eid], h.x, h.y, h.z)
    ) {
      die(state);
      return true;
    }
  }
  for (const hid of hostileMissileIds) {
    if (!state.exists(hid)) continue;
    if (planeOverlapsHostileMissile(state, hid)) {
      die(state);
      return true;
    }
  }
  return false;
}

function playerMissileOverlapsEnemy(state: GAME.State, mid: number, eid: number): boolean {
  const mh = PLAYER_MISSILE_HALF;
  const k = enemyKind.get(eid);
  const eh = k === 'foePurple' ? FOE_PURP_COLL_HALF : FOE_RED_COLL_HALF;
  const mx = Body.posX[mid];
  const my = Body.posY[mid];
  const mz = Body.posZ[mid];
  const ex = Body.posX[eid];
  const ey = Body.posY[eid];
  const ez = Body.posZ[eid];
  const mvz = Body.velZ[mid];
  const evz = Body.velZ[eid];
  const step = Math.max(state.time.deltaTime, state.time.fixedDeltaTime);
  const zSlack = Math.abs(mvz - evz) * step + 3 * S;
  const xySlack = 0.45 * S;
  return (
    Math.abs(mx - ex) < mh.x + eh.x + xySlack &&
    Math.abs(my - ey) < mh.y + eh.y + xySlack &&
    Math.abs(mz - ez) < mh.z + eh.z + zSlack
  );
}

function tryPlayerMissilesVsEnemies(state: GAME.State) {
  for (const mid of [...missileIds]) {
    if (!state.exists(mid)) continue;
    for (const eid of [...enemyIds]) {
      if (!state.exists(eid)) continue;
      if (!playerMissileOverlapsEnemy(state, mid, eid)) continue;
      const pts = enemyKind.get(eid) === 'foePurple' ? SCORE_FOE_PURPLE : SCORE_FOE_RED;
      addScore(pts);
      fuel = Math.min(100, fuel + 6);
      spawnMissileKillRing(
        state,
        (Body.posX[mid] + Body.posX[eid]) * 0.5,
        (Body.posY[mid] + Body.posY[eid]) * 0.5,
        (Body.posZ[mid] + Body.posZ[eid]) * 0.5,
      );
      destroyEntity(state, mid);
      destroyEntity(state, eid);
      break;
    }
  }
}

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
/** Наклон orbit: меньше — больше горизонт впереди (враги «выше» в кадре за счёт перспективы). */
const CAM_PITCH = 1.08;
const CAM_DIST = 92 * S * 1.72;
/**
 * Точка look-at заметно выше самолёта — он в кадре у нижней четверти экрана.
 * (Поднимать врагов тем же числом по миру Y нельзя: ломаются AABB с игроком/ракетами.)
 */
const CAM_LOOK_OFFSET_Y = 8.6 * S;

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
const missileIds = new Set<number>();
const hostileMissileIds = new Set<number>();
const enemyIds = new Set<number>();
type EnemyKind = 'foeRed' | 'foePurple';
const enemyKind = new Map<number, EnemyKind>();

type FoePlaneExtra = {
  /** Весь самолёт в одном объекте Three.js — копия геометрии игрока + поворот π навстречу. */
  root: THREE.Group;
  shootAcc: number;
  strafePhase: number;
};
const foePlaneByEnemy = new Map<number, FoePlaneExtra>();

/** Смещения визуала от Body (как спрайт RR: белый корпус, жёлтые крылья/хвост, тёмный нос). */
const planeVis: { eid: number; ox: number; oy: number; oz: number; yaw: number }[] = [];
/** Одно жёлтое крыло-треугольник (не box), синхронизируется в syncPlaneRiverRaidVis */
let planeDeltaWingMesh: THREE.Mesh | null = null;
let planeDeltaWingOx = 0;
let planeDeltaWingOy = 0;
let planeDeltaWingOz = 0;

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

type KillRingFx = {
  mesh: THREE.Mesh;
  t: number;
  expand: number;
  fadeK: number;
  tMax: number;
  opacity0: number;
};
let killRingFx: KillRingFx[] = [];
/** Задержка перед показом меню после гибели джета (сек). */
let deathMenuDelay = 0;

type Bridge = {
  z: number;
  destroyed: boolean;
  pylL: number;
  pylR: number;
  vis: number[];
};
const bridges: Bridge[] = [];

let enemySpawnTimer = 1.1;
let initialized = false;
/** Ссылка на мир для кнопки оверлея (после init). */
let uiStateRef: GAME.State | null = null;
type RunState =
  | 'playing'
  | 'death_fx_continue'
  | 'death_fx_game_over'
  | 'paused_continue'
  | 'paused_game_over';
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
/** Враг красный в 2× крупнее прежнего; фиолетовый в 2× к прежнему «половинному». */
const FOE_VIS_RED = PLANE_VIS_SCALE * 2;
const FOE_VIS_PURPLE = PLANE_VIS_SCALE;

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

/** Пять боксов самолёта — единственное место с размерами; игрок и враги. */
function appendRiverRaidPlaneVisBoxes(
  state: GAME.State,
  V: number,
  wingStripHex: string,
  out: { eid: number; ox: number; oy: number; oz: number; yaw: number }[],
) {
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
    out.push({ eid: id, ox: ox * S, oy: oy * S, oz: oz * S, yaw });
  };
  add(0, 0.36 * V, 0, 0.74 * S * V, 0.48 * S * V, 5.05 * S * V, C.planeBody, 0);
  add(0, 0.36 * V, 3.08 * V, 0.36 * S * V, 0.36 * S * V, 1.0 * S * V, C.planeNose, 0);
  add(0, 0.72 * V, 0.38 * V, 0.32 * S * V, 0.16 * S * V, 0.95 * S * V, C.planeCockpit, 0);
  add(0, 0.07 * V, -2.12 * V, 1.65 * S * V, 0.15 * S * V, 0.52 * S * V, wingStripHex, 0);
  add(0, 0.92 * V, -2.18 * V, 0.1 * S * V, 0.55 * S * V, 0.46 * S * V, C.planeTail, 0);
}

function attachDeltaWingMesh(state: GAME.State, V: number, wingHex: string): THREE.Mesh {
  const span = 5.35 * S * V;
  const chord = 2.05 * S * V;
  const halfT = 0.055 * S * V;
  const wingGeo = buildDeltaWingGeometry(span, chord, halfT);
  const wingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(wingHex),
    side: THREE.DoubleSide,
    fog: true,
  });
  const delta = new THREE.Mesh(wingGeo, wingMat);
  delta.renderOrder = 2;
  getRenderingContext(state).scene.add(delta);
  return delta;
}

function buildPlaneRiverRaidVis(state: GAME.State) {
  planeVis.length = 0;
  const V = PLANE_VIS_SCALE;
  disposePlaneDeltaWing(state);
  planeDeltaWingMesh = attachDeltaWingMesh(state, V, C.planeWing);
  planeDeltaWingOx = 0;
  planeDeltaWingOy = 0.035 * V * S;
  planeDeltaWingOz = -0.08 * V * S;
  appendRiverRaidPlaneVisBoxes(state, V, C.planeWing, planeVis);
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

/**
 * Враг: те же числа, что в appendRiverRaidPlaneVisBoxes + дельта, всё в одном Group.
 * Инстансы ECS для корпуса давали «только крыло» — отдельный Mesh крыла и инстансы в разных проходах depth.
 */
function buildFoeMirrorPlaneGroup(state: GAME.State, V: number, wingHex: string): THREE.Group {
  const root = new THREE.Group();
  const mkMat = (hex: string) =>
    new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), fog: true });

  const box = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, hex: string) => {
    const geom = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geom, mkMat(hex));
    mesh.position.set(lx, ly, lz);
    root.add(mesh);
  };

  box(0, 0.36 * V * S, 0, 0.74 * S * V, 0.48 * S * V, 5.05 * S * V, C.planeBody);
  box(0, 0.36 * V * S, 3.08 * V * S, 0.36 * S * V, 0.36 * S * V, 1.0 * S * V, C.planeNose);
  box(0, 0.72 * V * S, 0.38 * V * S, 0.32 * S * V, 0.16 * S * V, 0.95 * S * V, C.planeCockpit);
  box(0, 0.07 * V * S, -2.12 * V * S, 1.65 * S * V, 0.15 * S * V, 0.52 * S * V, wingHex);
  box(0, 0.92 * V * S, -2.18 * V * S, 0.1 * S * V, 0.55 * S * V, 0.46 * S * V, C.planeTail);

  const span = 5.35 * S * V;
  const chord = 2.05 * S * V;
  const halfT = 0.055 * S * V;
  const wingGeo = buildDeltaWingGeometry(span, chord, halfT);
  const wingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(wingHex),
    side: THREE.DoubleSide,
    fog: true,
  });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.position.set(0, 0.035 * V * S, -0.08 * V * S);
  wing.renderOrder = 2;
  root.add(wing);

  getRenderingContext(state).scene.add(root);
  return root;
}

function disposeFoePlaneExtra(state: GAME.State, fe: FoePlaneExtra) {
  const sc = getRenderingContext(state).scene;
  sc.remove(fe.root);
  fe.root.traverse((ch) => {
    if (ch instanceof THREE.Mesh) {
      ch.geometry.dispose();
      (ch.material as THREE.MeshBasicMaterial).dispose();
    }
  });
}

function disposeFoePlaneIfNeeded(state: GAME.State, eid: number) {
  const fe = foePlaneByEnemy.get(eid);
  if (!fe) return;
  disposeFoePlaneExtra(state, fe);
  foePlaneByEnemy.delete(eid);
}

function syncFoePlaneVis(state: GAME.State) {
  for (const [eid, fe] of [...foePlaneByEnemy.entries()]) {
    if (!state.exists(eid)) {
      disposeFoePlaneExtra(state, fe);
      foePlaneByEnemy.delete(eid);
      continue;
    }
    const px = Body.posX[eid];
    const py = Body.posY[eid];
    const pz = Body.posZ[eid];
    fe.root.position.set(px, py, pz);
    fe.root.rotation.set(0, Math.PI, 0);
  }
}

function foeApproachSpeed(state: GAME.State): number {
  if (planeId < 0 || !state.exists(planeId)) return BASE_FORWARD * 0.78;
  const vz = Math.abs(Body.velZ[planeId]);
  return Math.max(BASE_FORWARD * 0.28, Math.min(BASE_FORWARD * 1.18, vz));
}

function destroyEntity(state: GAME.State, eid: number) {
  disposeFoePlaneIfNeeded(state, eid);
  if (state.exists(eid)) state.destroyEntity(eid);
  missileIds.delete(eid);
  hostileMissileIds.delete(eid);
  enemyIds.delete(eid);
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

/** Базовые радиусы кольца до правки «×4» от первой версии. */
const MISSILE_RING_IN = 0.22 * S * 4;
const MISSILE_RING_OUT = 0.48 * S * 4;

function pushKillRingBurst(
  state: GAME.State,
  x: number,
  y: number,
  z: number,
  inner: number,
  outer: number,
  color: number,
  opacity0: number,
  expand: number,
  fadeK: number,
  tMax: number,
) {
  const rc = getRenderingContext(state);
  const ring = new THREE.RingGeometry(inner, outer, 56);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opacity0,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(ring, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.renderOrder = 7;
  rc.scene.add(mesh);
  killRingFx.push({ mesh, t: 0, expand, fadeK, tMax, opacity0 });
}

/** Попадание ракеты: крупное красное кольцо (~×4 к исходному). */
function spawnMissileKillRing(state: GAME.State, x: number, y: number, z: number) {
  pushKillRingBurst(
    state,
    x,
    y,
    z,
    MISSILE_RING_IN,
    MISSILE_RING_OUT,
    0xff2a28,
    0.88,
    6.2,
    0.95,
    1.12,
  );
}

/** Гибель нашего джета: то же по стилю, заметно крупнее и дольше на экране. */
function spawnPlaneDeathRing(state: GAME.State, x: number, y: number, z: number) {
  const mul = 2.65;
  pushKillRingBurst(
    state,
    x,
    y,
    z,
    MISSILE_RING_IN * mul,
    MISSILE_RING_OUT * mul,
    0xff3a32,
    0.92,
    4.2,
    0.42,
    2.35,
  );
  pushKillRingBurst(
    state,
    x,
    y,
    z,
    MISSILE_RING_IN * mul * 0.42,
    MISSILE_RING_OUT * mul * 0.5,
    0xff8060,
    0.55,
    5.4,
    0.55,
    1.85,
  );
}

function updateKillRingFx(state: GAME.State, dt: number) {
  const sc = getRenderingContext(state).scene;
  for (let i = killRingFx.length - 1; i >= 0; i--) {
    const r = killRingFx[i]!;
    r.t += dt * 1.15;
    const s = 1 + r.t * r.expand;
    r.mesh.scale.setScalar(s);
    const mat = r.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, r.opacity0 * (1 - r.t * r.fadeK));
    if (r.t > r.tMax || mat.opacity <= 0.001) {
      sc.remove(r.mesh);
      r.mesh.geometry.dispose();
      mat.dispose();
      killRingFx.splice(i, 1);
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
  for (const k of killRingFx) {
    sc.remove(k.mesh);
    k.mesh.geometry.dispose();
    (k.mesh.material as THREE.MeshBasicMaterial).dispose();
  }
  killRingFx.length = 0;
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
  for (const h of [...hostileMissileIds]) destroyEntity(state, h);
  for (const e of [...enemyIds]) destroyEntity(state, e);
  missileIds.clear();
  hostileMissileIds.clear();
  enemyIds.clear();
  enemyKind.clear();
  enemySpawnTimer = 1.2;
  score = 0;
  fuel = 100;
  jetsLeft = 3;
  checkpointZ = 0;
  extraLifeMilestone = 0;
  for (const d of depots) {
    d.destroyed = false;
    /* визуалы не пересоздаём при полном сбросе — сессия та же; депо остаётся «срубленным» по визуалу */
  }
  clearRefuelFx(state);
  deathMenuDelay = 0;
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
  for (const h of [...hostileMissileIds]) destroyEntity(state, h);
  for (const e of [...enemyIds]) destroyEntity(state, e);
  missileIds.clear();
  hostileMissileIds.clear();
  enemyIds.clear();
  enemyKind.clear();
  enemySpawnTimer = 1.2;
  fuel = 100;
  deathMenuDelay = 0;
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
    spawnPlaneDeathRing(state, Body.posX[planeId], Body.posY[planeId], Body.posZ[planeId]);
  }
  for (const mid of missileIds) {
    if (state.exists(mid)) state.addComponent(mid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
  }
  for (const eid of enemyIds) {
    if (state.exists(eid)) state.addComponent(eid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
  }
  for (const hid of hostileMissileIds) {
    if (state.exists(hid)) state.addComponent(hid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
  }
  deathMenuDelay = 3;
  if (jetsLeft <= 0) {
    runState = 'death_fx_game_over';
    return;
  }
  runState = 'death_fx_continue';
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
  const ringY = -2.62 * S;
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
        spawnMissileKillRing(state, rcx, ringY, b.z);
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
        spawnMissileKillRing(state, d.cx, ringY, d.cz);
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

  for (let z = Z_SEG_START + 55 * S; z < Z_SEG_END; z += FUEL_DEPOT_Z_STEP) {
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
    'offset-y': `${CAM_LOOK_OFFSET_Y}`,
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
  OrbitCamera.offsetX[cam] = 0;
  OrbitCamera.offsetY[cam] = CAM_LOOK_OFFSET_Y;
  OrbitCamera.offsetZ[cam] = 0;
  OrbitCamera.sensitivity[cam] = 0;
  OrbitCamera.zoomSensitivity[cam] = 0;

}

const physicsWorldQuery = GAME.defineQuery([PhysicsWorld]);
const touchedQuery = GAME.defineQuery([TouchedEvent]);
const renderContextQuery = GAME.defineQuery([RenderContext]);

/** Касание: сдвиг пальца от точки нажатия → moveX; короткий тап → выстрел. */
let touchSteerX = 0;
let touchPointerActive = false;
let touchDown: { x: number; y: number; t: number } | null = null;
let activeTouchPointerId: number | null = null;
let touchFirePending = false;

function installMobileControls(canvas: HTMLCanvasElement) {
  const steerDenominator = () => Math.max(window.innerWidth, 320) * 0.2;
  const tapSlopPx = 16;
  const tapMaxMs = 420;

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      if (e.pointerType === 'mouse') return;
      if (activeTouchPointerId !== null) return;
      activeTouchPointerId = e.pointerId;
      touchPointerActive = true;
      touchDown = { x: e.clientX, y: e.clientY, t: performance.now() };
      touchSteerX = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      try {
        canvas.focus();
      } catch {
        /* ignore */
      }
    },
    { passive: true },
  );

  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== activeTouchPointerId || !touchDown) return;
      const dx = e.clientX - touchDown.x;
      const span = steerDenominator();
      touchSteerX = Math.max(-1, Math.min(1, span > 1e-6 ? dx / span : 0));
    },
    { passive: true },
  );

  const endTouch = (e: PointerEvent) => {
    if (e.pointerId !== activeTouchPointerId || !touchDown) return;
    const dt = performance.now() - touchDown.t;
    const moved = Math.hypot(e.clientX - touchDown.x, e.clientY - touchDown.y);
    if (moved < tapSlopPx && dt < tapMaxMs) touchFirePending = true;
    touchPointerActive = false;
    touchDown = null;
    activeTouchPointerId = null;
    touchSteerX = 0;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
}

function consumeTouchFire(): boolean {
  if (!touchFirePending) return false;
  touchFirePending = false;
  return true;
}

const inputSystems = InputPlugin.systems;
if (!inputSystems?.[0]) throw new Error('InputPlugin: expected InputSystem');
const InputSystemRef = inputSystems[0] as GAME.System;

const TouchSteerInput: GAME.System = {
  group: 'simulation',
  after: [InputSystemRef],
  update: (state) => {
    if (planeId < 0 || !state.exists(planeId)) return;
    if (touchPointerActive) InputState.moveX[planeId] = touchSteerX;
  },
};

const InitRuntime: GAME.System = {
  setup: (state) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
    const ctxEnt = renderContextQuery(state.world)[0];
    if (canvas && ctxEnt !== undefined) setCanvasElement(ctxEnt, canvas);
    if (canvas) installMobileControls(canvas);
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
      for (const hid of hostileMissileIds) {
        if (!state.exists(hid)) continue;
        state.addComponent(hid, SetLinearVelocity, { x: 0, y: 0, z: 0 });
      }
      syncFoePlaneVis(state);
      return;
    }

    const mx = InputState.moveX[planeId] ?? 0;
    const my = InputState.moveY[planeId] ?? 0;
    /* W / стрелка вверх — ускорение вперёд, S / вниз — замедление (как джойстик RR) */
    const speedMul = Math.max(0.28, Math.min(1.18, 0.78 + my * 0.32));
    const forward = BASE_FORWARD * speedMul;

    /* Камера сзади по +Z: инверсия как у «джойстика вверх» в оригинале на ПК */
    const vx = -mx * STRAFE_SPEED;

    state.addComponent(planeId, SetLinearVelocity, {
      x: vx,
      y: 0,
      z: FZ * forward,
    });

    syncPlaneRiverRaidVis(state);

    const approach = foeApproachSpeed(state);
    for (const eid of enemyIds) {
      if (!state.exists(eid)) continue;
      let vx = 0;
      if (enemyKind.get(eid) === 'foePurple') {
        const fe = foePlaneByEnemy.get(eid);
        const ph = fe?.strafePhase ?? 0;
        vx = STRAFE_SPEED * 0.4 * Math.sin(state.time.elapsed * 1.35 + ph);
      }
      state.addComponent(eid, SetLinearVelocity, { x: vx, y: 0, z: -FZ * approach });
    }
    for (const mid of missileIds) {
      if (!state.exists(mid)) continue;
      state.addComponent(mid, SetLinearVelocity, { x: 0, y: 0, z: FZ * MISSILE_SPEED });
    }
    for (const hid of hostileMissileIds) {
      if (!state.exists(hid)) continue;
      state.addComponent(hid, SetLinearVelocity, { x: 0, y: 0, z: -FZ * HOSTILE_MISSILE_SPEED });
    }
    syncFoePlaneVis(state);
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
        OrbitCamera.offsetX[cameraId] = 0;
        OrbitCamera.offsetY[cameraId] = CAM_LOOK_OFFSET_Y;
        OrbitCamera.offsetZ[cameraId] = 0;
        OrbitCamera.sensitivity[cameraId] = 0;
        OrbitCamera.zoomSensitivity[cameraId] = 0;
      }
      updateHud(pz, fuel < 26);
      updateRefuelRipples(state, dt);
      updateKillRingFx(state, dt);
      if (runState === 'death_fx_continue' || runState === 'death_fx_game_over') {
        deathMenuDelay -= dt;
        if (deathMenuDelay <= 0) {
          deathMenuDelay = 0;
          if (runState === 'death_fx_game_over') {
            runState = 'paused_game_over';
            showGameEndOverlay('game_over');
          } else {
            runState = 'paused_continue';
            showGameEndOverlay('continue');
          }
        }
      }
      return;
    }

    if (cameraId >= 0 && state.exists(cameraId)) {
      OrbitCamera.targetYaw[cameraId] = CAM_YAW;
      OrbitCamera.currentYaw[cameraId] = CAM_YAW;
      OrbitCamera.targetPitch[cameraId] = CAM_PITCH;
      OrbitCamera.currentPitch[cameraId] = CAM_PITCH;
      OrbitCamera.targetDistance[cameraId] = CAM_DIST;
      OrbitCamera.currentDistance[cameraId] = CAM_DIST;
      OrbitCamera.offsetX[cameraId] = 0;
      OrbitCamera.offsetY[cameraId] = CAM_LOOK_OFFSET_Y;
      OrbitCamera.offsetZ[cameraId] = 0;
      OrbitCamera.sensitivity[cameraId] = 0;
      OrbitCamera.zoomSensitivity[cameraId] = 0;
    }

    const halfR = riverHalfAt(pz);
    const rcxR = riverCenterXAt(pz);
    const innerL = rcxR - halfR - WATER_BANK_INSET;
    const innerR = rcxR + halfR + WATER_BANK_INSET;
    if (px - PLANE_HITBOX_HALF_X <= innerL || px + PLANE_HITBOX_HALF_X >= innerR) {
      die(state);
      return;
    }
    if (tryPlaneVsFoesAndHostileMissiles(state)) return;

    fuel -= dt * FUEL_DRAIN_PER_SEC;
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
    updateKillRingFx(state, dt);

    updateHud(pz, lowFuel);
    tryMissileWorldHits(state);
    tryPlayerMissilesVsEnemies(state);

    for (const mid of [...missileIds]) {
      if (!state.exists(mid)) missileIds.delete(mid);
    }
    if ((consumePrimary() || consumeTouchFire()) && missileIds.size === 0) {
      const x = Body.posX[planeId];
      const y = Body.posY[planeId];
      const z = Body.posZ[planeId];
      const nose = 3.62 * S * PLANE_VIS_SCALE;
      const m = state.createFromRecipe('kinematic-part', {
        pos: `${x} ${y} ${z + FZ * nose}`,
        shape: 'box',
        size: `${0.52 * S} ${0.52 * S} ${2.5 * S}`,
        color: C.bullet,
      });
      state.addComponent(m, CollisionEvents, { activeEvents: 1 });
      missileIds.add(m);
    }

    enemySpawnTimer -= dt;
    if (enemySpawnTimer <= 0) {
      enemySpawnTimer = ENEMY_SPAWN_EVERY;
      const purple = Math.random() < 0.5;
      const V = purple ? FOE_VIS_PURPLE : FOE_VIS_RED;
      const wing = purple ? C.foePurpleWing : C.foeRedWing;
      const kind: EnemyKind = purple ? 'foePurple' : 'foeRed';
      const sx = purple ? 2.9 * S : 5.8 * S;
      const sy = purple ? 0.84 * S : 1.68 * S;
      const sz = purple ? 5.4 * S : 10.8 * S;
      const ezPred = pz + FZ * ENEMY_SPAWN_RIVER_SAMPLE_AHEAD;
      const half = riverHalfAt(ezPred);
      const ecx = riverCenterXAt(ezPred);
      const rx = ecx + (Math.random() - 0.5) * (half * 1.5);
      const ex = Math.min(ecx + half - 2.85 * S, Math.max(ecx - half + 2.85 * S, rx));
      const ez = pz + FZ * (ENEMY_SPAWN_AHEAD_MIN + Math.random() * ENEMY_SPAWN_AHEAD_SPREAD);
      const ey = Body.posY[planeId] + (Math.random() - 0.5) * 0.35 * S;
      const en = state.createFromRecipe('kinematic-part', {
        pos: `${ex} ${ey} ${ez}`,
        shape: 'box',
        size: `${sx} ${sy} ${sz}`,
        color: C.planeBody,
      });
      state.addComponent(en, CollisionEvents, { activeEvents: 1 });
      Renderer.visible[en] = 0;
      enemyIds.add(en);
      enemyKind.set(en, kind);
      const root = buildFoeMirrorPlaneGroup(state, V, wing);
      foePlaneByEnemy.set(en, {
        root,
        shootAcc: purple ? 0.2 : 0,
        strafePhase: Math.random() * Math.PI * 2,
      });
    }

    for (const eid of enemyIds) {
      if (enemyKind.get(eid) !== 'foePurple') continue;
      const fe = foePlaneByEnemy.get(eid);
      if (!fe || !state.exists(eid)) continue;
      fe.shootAcc -= dt;
      if (fe.shootAcc > 0) continue;
      fe.shootAcc = 1;
      const Vp = FOE_VIS_PURPLE;
      const noseZ = 3.62 * S * Vp;
      const hm = state.createFromRecipe('kinematic-part', {
        pos: `${Body.posX[eid]} ${Body.posY[eid]} ${Body.posZ[eid] - FZ * noseZ}`,
        shape: 'box',
        size: `${0.34 * S} ${0.34 * S} ${1.38 * S}`,
        color: C.hostileMissile,
      });
      state.addComponent(hm, CollisionEvents, { activeEvents: 1 });
      hostileMissileIds.add(hm);
    }

    for (const mid of [...missileIds]) {
      if (!state.exists(mid)) {
        missileIds.delete(mid);
        continue;
      }
      const along = FZ * (Body.posZ[mid] - pz);
      if (along > 130 * S) destroyEntity(state, mid);
    }
    for (const hid of [...hostileMissileIds]) {
      if (!state.exists(hid)) {
        hostileMissileIds.delete(hid);
        continue;
      }
      if (FZ * (pz - Body.posZ[hid]) > 95 * S) destroyEntity(state, hid);
    }
    for (const eid of [...enemyIds]) {
      if (!state.exists(eid)) {
        enemyIds.delete(eid);
        continue;
      }
      if (FZ * (Body.posZ[eid] - pz) < -42 * S) destroyEntity(state, eid);
    }
    if (tryPlaneVsFoesAndHostileMissiles(state)) return;

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

      if (eid === planeId && hostileMissileIds.has(other)) {
        die(state);
        continue;
      }
      if (other === planeId && hostileMissileIds.has(eid)) {
        die(state);
        continue;
      }

      if (missileIds.has(eid) && hostileMissileIds.has(other)) {
        destroyEntity(state, eid);
        destroyEntity(state, other);
        continue;
      }
      if (missileIds.has(other) && hostileMissileIds.has(eid)) {
        destroyEntity(state, other);
        destroyEntity(state, eid);
        continue;
      }

      if (missileIds.has(eid) && hazardIds.has(other)) destroyEntity(state, eid);
      if (missileIds.has(other) && hazardIds.has(eid)) destroyEntity(state, other);

      if (hostileMissileIds.has(eid) && hazardIds.has(other)) destroyEntity(state, eid);
      if (hostileMissileIds.has(other) && hazardIds.has(eid)) destroyEntity(state, other);
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
GAME.withSystem(TouchSteerInput);
GAME.withSystem(GameplaySim);

document.getElementById('game-end-btn')?.addEventListener('click', () => {
  const st = uiStateRef;
  if (!st || runState === 'playing') return;
  if (runState === 'paused_continue') {
    runState = 'playing';
    deathMenuDelay = 0;
    hideGameEndOverlay();
    respawnAtCheckpoint(st);
  } else if (runState === 'paused_game_over') {
    runState = 'playing';
    deathMenuDelay = 0;
    hideGameEndOverlay();
    resetJetsAndProgress(st);
  }
});

void GAME.run();
