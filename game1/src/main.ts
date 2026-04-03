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
  bullet: '#fff8a0',
  enemyHelo: '#c018c8',
  enemyJet: '#9098a8',
  enemyShip: '#6b3c18',
  wake: '#a8e8ff',
  bridgeWood: '#704028',
  bridgeRail: '#5a3418',
  fuelWhite: '#f0f0f0',
  fuelRed: '#d02028',
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

type EnemyKind = 'helo' | 'ship' | 'jet';
const enemyKind = new Map<number, EnemyKind>();

type FuelDepot = {
  cx: number;
  cz: number;
  key: string;
  destroyed: boolean;
  vis: number[];
};
const depots: FuelDepot[] = [];

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
let score = 0;
let fuel = 100;
/** Сколько машин осталось включая текущую (как «три джета» в оригинале). */
let jetsLeft = 3;
let checkpointZ = 0;
let extraLifeMilestone = 0;
let horizonAtmosphereApplied = false;

function riverHalfAt(z: number): number {
  return RIVER_HALF_MAX * (72 + 28 * Math.sin(z * 0.0191 + 1.05)) * (1 / 100);
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

function buildPlaneRiverRaidVis(state: GAME.State) {
  planeVis.length = 0;
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
  add(0, 0.02, 0, 1.12 * S, 0.3 * S, 2.32 * S, C.planeBody, 0);
  add(-0.58, 0.02, -0.08, 0.48 * S, 0.08 * S, 1.42 * S, C.planeWing, 0.38);
  add(0.58, 0.02, -0.08, 0.48 * S, 0.08 * S, 1.42 * S, C.planeWing, -0.38);
  add(0, 0.05, -1.02, 0.35 * S, 0.1 * S, 0.58 * S, C.planeTail, 0);
  add(0, 0.03, 1.08, 0.38 * S, 0.2 * S, 0.52 * S, C.planeNose, 0);
  add(-0.22, 0.04, 0.75, 0.16 * S, 0.12 * S, 0.45 * S, C.planeWing, 0);
  add(0.22, 0.04, 0.75, 0.16 * S, 0.12 * S, 0.45 * S, C.planeWing, 0);
}

function syncPlaneRiverRaidVis(state: GAME.State) {
  if (planeId < 0 || !state.exists(planeId)) return;
  const px = Body.posX[planeId];
  const py = Body.posY[planeId];
  const pz = Body.posZ[planeId];
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
  if (planeId >= 0 && state.exists(planeId)) {
    Body.posX[planeId] = 0;
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
    Body.posX[planeId] = 0;
    Body.posY[planeId] = 4.8 * S;
    Body.posZ[planeId] = checkpointZ + 8 * S;
    Body.velX[planeId] = 0;
    Body.velY[planeId] = 0;
    Body.velZ[planeId] = 0;
  }
}

function die(state: GAME.State) {
  jetsLeft -= 1;
  if (jetsLeft <= 0) {
    resetJetsAndProgress(state);
    return;
  }
  respawnAtCheckpoint(state);
}

function addScore(points: number) {
  score += points;
  const m = Math.floor(score / 10000);
  while (extraLifeMilestone < m) {
    extraLifeMilestone += 1;
    if (jetsLeft < 9) jetsLeft += 1;
  }
}

const DEPOT_RX = 2.2 * S;
const DEPOT_RZ = 3.2 * S;
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
      if (Math.abs(mz - b.z) < BRIDGE_KILL_Z && Math.abs(mx) < hw) {
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
    const hBase = (4.85 + Math.sin(zc * 0.0035) * 1.25) * S;
    const sliceLen = BANK_SLICE * 1.06;

    const innerL = -half - WATER_BANK_INSET;
    const innerR = half + WATER_BANK_INSET;
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
    Transform.posX[m] = 0;
    Transform.posY[m] = -1.05 * S;
    Transform.posZ[m] = z;
  }

  for (let z = Z_SEG_START + 72 * S; z < Z_SEG_END; z += 200 * S) {
    const half = riverHalfAt(z);
    const span = half * 2 + 1.8 * S;
    const deck = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${span} ${0.55 * S} ${3.6 * S}`,
      color: C.bridgeWood,
    });
    Transform.posX[deck] = 0;
    Transform.posY[deck] = 11.5 * S;
    Transform.posZ[deck] = z;
    const railL = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.22 * S} ${0.4 * S} ${3.7 * S}`,
      color: C.bridgeRail,
    });
    Transform.posX[railL] = -span * 0.5 + 0.2 * S;
    Transform.posY[railL] = 11.85 * S;
    Transform.posZ[railL] = z;
    const railR = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.22 * S} ${0.4 * S} ${3.7 * S}`,
      color: C.bridgeRail,
    });
    Transform.posX[railR] = span * 0.5 - 0.2 * S;
    Transform.posY[railR] = 11.85 * S;
    Transform.posZ[railR] = z;

    const pylH = 14 * S;
    const pylW = 1.25 * S;
    const pylGap = 2.85 * S;
    const pylL = state.createFromRecipe('static-part', {
      pos: `${-(half + pylGap)} ${-0.2 * S} ${z}`,
      shape: 'box',
      size: `${pylW} ${pylH} ${2.8 * S}`,
      color: C.bridgeWood,
    });
    hazardIds.add(pylL);
    state.addComponent(pylL, CollisionEvents, { activeEvents: 1 });
    const pylR = state.createFromRecipe('static-part', {
      pos: `${half + pylGap} ${-0.2 * S} ${z}`,
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
    const lane = (Math.sin(z * 0.11) * 0.55 + Math.sin(z * 0.037) * 0.35) * half * 0.82;
    const key = `dep-${Math.round(z * 10)}`;
    const base = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${2.8 * S} ${0.55 * S} ${4.2 * S}`,
      color: C.fuelWhite,
    });
    Transform.posX[base] = lane;
    Transform.posY[base] = -1.62 * S;
    Transform.posZ[base] = z;
    const stripe = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${2.85 * S} ${0.18 * S} ${4.25 * S}`,
      color: C.fuelRed,
    });
    Transform.posX[stripe] = lane;
    Transform.posY[stripe] = -1.38 * S;
    Transform.posZ[stripe] = z;
    const house = state.createFromRecipe('renderer', {
      shape: 'box',
      size: `${0.75 * S} ${0.85 * S} ${0.85 * S}`,
      color: C.fuelWhite,
    });
    Transform.posX[house] = lane - 0.75 * S;
    Transform.posY[house] = -1.05 * S;
    Transform.posZ[house] = z - 1.2 * S;

    depots.push({ cx: lane, cz: z, key, destroyed: false, vis: [base, stripe, house] });
  }

  planeId = state.createFromRecipe('kinematic-part', {
    pos: `0 ${4.8 * S} 0`,
    shape: 'box',
    size: `${1.45 * S} ${0.42 * S} ${2.7 * S}`,
    color: C.planeBody,
  });
  Renderer.visible[planeId] = 0;
  state.addComponent(planeId, InputState);
  state.addComponent(planeId, CollisionEvents, { activeEvents: 1 });
  buildPlaneRiverRaidVis(state);

  const cam = state.createFromRecipe('orbit-camera', {
    'target-distance': `${CAM_DIST}`,
    'target-pitch': String(CAM_PITCH),
    'offset-y': `${1.15 * S}`,
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
    const planeXMin = -half + 2.85 * S;
    const planeXMax = half - 2.85 * S;
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
    applyRiverHorizonAtmosphere(state);
    const dt = state.time.deltaTime;
    const pz = Body.posZ[planeId];
    const px = Body.posX[planeId];

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

    for (const d of depots) {
      if (d.destroyed) continue;
      if (Math.abs(px - d.cx) < DEPOT_RX && Math.abs(pz - d.cz) < DEPOT_RZ) {
        fuel = Math.min(100, fuel + dt * 42);
      }
    }

    updateHud(pz, lowFuel);
    tryMissileWorldHits(state);

    shootCooldownLeft = Math.max(0, shootCooldownLeft - dt);
    if (consumePrimary() && shootCooldownLeft <= 0) {
      shootCooldownLeft = SHOOT_COOLDOWN;
      const x = Body.posX[planeId];
      const y = Body.posY[planeId];
      const z = Body.posZ[planeId];
      const nose = 2.1 * S;
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
      const half = riverHalfAt(pz + FZ * 55 * S);
      const rx = (Math.random() - 0.5) * (half * 1.65);
      const ex = Math.min(half - 2.85 * S, Math.max(-half + 2.85 * S, rx));
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

void GAME.run();
