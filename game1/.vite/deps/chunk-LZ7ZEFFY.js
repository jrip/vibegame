import {
  m as m2
} from "./chunk-SFEIHVB6.js";
import {
  l as l2,
  p as p2,
  t
} from "./chunk-PK4QV4TF.js";
import {
  i as i2
} from "./chunk-Z5M7ZCDK.js";
import {
  c as c2,
  l,
  m,
  p,
  u
} from "./chunk-K753QHTE.js";
import {
  E
} from "./chunk-T4FKFSHD.js";
import {
  r as r2
} from "./chunk-57T52AMV.js";
import {
  i
} from "./chunk-VC3U7TRB.js";
import {
  c,
  n,
  r,
  s
} from "./chunk-QL5YCE4U.js";
import {
  Types,
  defineComponent,
  defineQuery,
  o
} from "./chunk-4ERPUZ7I.js";

// node_modules/vibegame/dist/plugins/animation/components.js
var n2 = defineComponent({
  headEntity: Types.eid,
  torsoEntity: Types.eid,
  leftArmEntity: Types.eid,
  rightArmEntity: Types.eid,
  leftLegEntity: Types.eid,
  rightLegEntity: Types.eid,
  phase: Types.f32,
  jumpTime: Types.f32,
  fallTime: Types.f32,
  animationState: Types.ui8,
  stateTransition: Types.f32
});
var a = defineComponent();

// node_modules/vibegame/dist/plugins/animation/constants.js
var e = {
  head: {
    size: { x: 0.35, y: 0.35, z: 0.35 },
    offset: { x: 0, y: 0.575, z: 0 },
    color: 16628916
  },
  torso: {
    size: { x: 0.45, y: 0.55, z: 0.3 },
    offset: { x: 0, y: 0.05, z: 0 },
    color: 4286945
  },
  leftArm: {
    size: { x: 0.175, y: 0.45, z: 0.175 },
    offset: { x: -0.3125, y: 0.15, z: 0 },
    color: 16628916
  },
  rightArm: {
    size: { x: 0.175, y: 0.45, z: 0.175 },
    offset: { x: 0.3125, y: 0.15, z: 0 },
    color: 16628916
  },
  leftLeg: {
    size: { x: 0.2, y: 0.475, z: 0.2 },
    offset: { x: -0.125, y: -0.5, z: 0 },
    color: 4734347
  },
  rightLeg: {
    size: { x: 0.2, y: 0.475, z: 0.2 },
    offset: { x: 0.125, y: -0.5, z: 0 },
    color: 4734347
  }
};
var o2 = {
  armSwingAngle: 30,
  legSwingAngle: 25,
  frequency: 0.5,
  jump: {
    armRaiseAngle: 45,
    bodyStretch: 0.12,
    legTuckAngle: 35,
    anticipationDuration: 0.1
  },
  fall: {
    armFlailAngle: 20,
    legDangleAngle: 15,
    bodyTiltAngle: 10,
    windSwayAmount: 0.05
  },
  landing: {
    duration: 0.15,
    bounceHeight: 0.04,
    squashAmount: 0.15
  }
};
var l3 = {
  IDLE: 0,
  WALKING: 1,
  JUMPING: 2,
  FALLING: 3,
  LANDING: 4
};

// node_modules/vibegame/dist/plugins/animation/utils.js
function x(o3, a2, n3) {
  const s3 = e[n3], l4 = o3.createEntity();
  return o3.addComponent(l4, r2), o3.addComponent(l4, n), o3.addComponent(l4, o), r2.posX[l4] = s3.offset.x, r2.posY[l4] = s3.offset.y, r2.posZ[l4] = s3.offset.z, r2.rotX[l4] = 0, r2.rotY[l4] = 0, r2.rotZ[l4] = 0, r2.rotW[l4] = 1, r2.scaleX[l4] = 1, r2.scaleY[l4] = 1, r2.scaleZ[l4] = 1, n.shape[l4] = 0, n.sizeX[l4] = s3.size.x, n.sizeY[l4] = s3.size.y, n.sizeZ[l4] = s3.size.z, n.color[l4] = s3.color, n.visible[l4] = 1, o.entity[l4] = a2, l4;
}
function Z(o3) {
  const a2 = o3 * Math.PI * 2;
  return {
    armRotation: Math.sin(a2) * o2.armSwingAngle,
    legRotation: Math.sin(a2) * o2.legSwingAngle
  };
}
function T(o3, a2, n3, s3, l4) {
  const { armRotation: r3, legRotation: c3 } = Z(l4);
  r2.eulerX[o3] = -r3, r2.eulerX[a2] = r3, r2.eulerX[n3] = c3, r2.eulerX[s3] = -c3;
}
function d(o3) {
  return 1 - Math.pow(1 - o3, 3);
}
function S(o3, a2, n3, s3, l4, r3, c3) {
  if (c3 < o2.jump.anticipationDuration) {
    const m3 = c3 / o2.jump.anticipationDuration, p3 = d(m3);
    r2.eulerX[n3] = -p3 * o2.jump.armRaiseAngle, r2.eulerX[s3] = -p3 * o2.jump.armRaiseAngle;
    const X = p3 * o2.jump.bodyStretch;
    r2.scaleY[a2] = 1 + X, r2.scaleX[a2] = 1 - X * 0.3, r2.scaleZ[a2] = 1 - X * 0.3;
    const Y = p3 * o2.jump.legTuckAngle;
    r2.eulerX[l4] = Y, r2.eulerX[r3] = Y;
  } else {
    const m3 = c3 - o2.jump.anticipationDuration, p3 = Math.sin(m3 * 3) * 5;
    r2.eulerX[n3] = -45 + p3, r2.eulerX[s3] = -45 - p3;
    const X = Math.sin(m3 * 4) * 0.02;
    r2.scaleX[a2] = 1 + X, r2.scaleY[a2] = 1, r2.scaleZ[a2] = 1 + X, r2.eulerX[l4] = o2.jump.legTuckAngle, r2.eulerX[r3] = o2.jump.legTuckAngle, r2.eulerX[o3] = 10;
  }
}
function k(o3, a2, n3, s3, l4, r3, c3) {
  const m3 = Math.max(0, c3 - 0.3), p3 = Math.sin(m3 * 5) * o2.fall.armFlailAngle;
  r2.eulerX[n3] = -12 + p3, r2.eulerX[s3] = -12 - p3, r2.eulerZ[n3] = -20, r2.eulerZ[s3] = 20, r2.eulerX[a2] = o2.fall.bodyTiltAngle, r2.eulerX[l4] = o2.fall.legDangleAngle, r2.eulerX[r3] = o2.fall.legDangleAngle, r2.eulerX[o3] = 20;
  const X = Math.sin(m3 * 2.5) * o2.fall.windSwayAmount;
  r2.posX[a2] = X, r2.posX[o3] = X * 0.5;
}
function D(o3, a2, n3) {
  const s3 = n3 / o2.landing.duration, l4 = Math.exp(-s3 * 8) * o2.landing.bounceHeight, r3 = Math.sin(s3 * Math.PI * 2) * l4;
  r2.posY[a2] = e.torso.offset.y + r3, r2.posY[o3] = e.head.offset.y + r3;
  const c3 = Math.exp(-s3 * 6) * o2.landing.squashAmount;
  r2.scaleX[a2] = 1 + c3 * 0.4, r2.scaleY[a2] = 1 - c3 * 0.8, r2.scaleZ[a2] = 1 + c3 * 0.4;
}
function C(o3, a2, n3, s3, l4, r3) {
  r2.posX[o3] = e.head.offset.x, r2.posY[o3] = e.head.offset.y, r2.posZ[o3] = e.head.offset.z, r2.posX[a2] = e.torso.offset.x, r2.posY[a2] = e.torso.offset.y, r2.posZ[a2] = e.torso.offset.z, r2.eulerX[o3] = 0, r2.eulerY[o3] = 0, r2.eulerZ[o3] = 0, r2.eulerX[a2] = 0, r2.eulerY[a2] = 0, r2.eulerZ[a2] = 0, r2.eulerX[n3] = 0, r2.eulerY[n3] = 0, r2.eulerZ[n3] = 0, r2.eulerX[s3] = 0, r2.eulerY[s3] = 0, r2.eulerZ[s3] = 0, r2.eulerX[l4] = 0, r2.eulerY[l4] = 0, r2.eulerZ[l4] = 0, r2.eulerX[r3] = 0, r2.eulerY[r3] = 0, r2.eulerZ[r3] = 0, r2.scaleX[o3] = 1, r2.scaleY[o3] = 1, r2.scaleZ[o3] = 1, r2.scaleX[a2] = 1, r2.scaleY[a2] = 1, r2.scaleZ[a2] = 1;
}

// node_modules/vibegame/dist/plugins/animation/systems.js
var N = defineQuery([n2]);
var B = {
  group: "setup",
  update(r3) {
    const p3 = N(r3.world).filter(
      (i3) => n2.headEntity[i3] === E
    );
    for (const i3 of p3)
      n2.headEntity[i3] = x(
        r3,
        i3,
        "head"
      ), n2.torsoEntity[i3] = x(
        r3,
        i3,
        "torso"
      ), n2.leftArmEntity[i3] = x(
        r3,
        i3,
        "leftArm"
      ), n2.rightArmEntity[i3] = x(
        r3,
        i3,
        "rightArm"
      ), n2.leftLegEntity[i3] = x(
        r3,
        i3,
        "leftLeg"
      ), n2.rightLegEntity[i3] = x(
        r3,
        i3,
        "rightLeg"
      );
  }
};
var Q = {
  group: "simulation",
  update(r3) {
    const p3 = N(r3.world), i3 = r3.time.deltaTime, c3 = r3.time.fixedDeltaTime;
    for (const e2 of p3) {
      if (o.entity[e2] === E) continue;
      const o3 = o.entity[e2], T2 = m.posY[o3], G = m.prevPosY[o3], M = u.grounded[o3] === 1;
      let l4 = false;
      if (r3.hasComponent(o3, i)) {
        const y = i.moveX[o3], f = i.moveY[o3];
        l4 = Math.abs(y) > 0.1 || Math.abs(f) > 0.1;
      }
      const v = (T2 - G) / c3;
      let A = 1;
      if (r3.hasComponent(o3, p) && l4) {
        const y = p.actualMoveX[o3], f = p.actualMoveZ[o3];
        A = Math.sqrt(y * y + f * f) / c3;
      }
      const s3 = n2.animationState[e2];
      let a2 = s3;
      switch (C(
        n2.headEntity[e2],
        n2.torsoEntity[e2],
        n2.leftArmEntity[e2],
        n2.rightArmEntity[e2],
        n2.leftLegEntity[e2],
        n2.rightLegEntity[e2]
      ), M ? s3 === l3.FALLING || s3 === l3.JUMPING ? (a2 = l3.LANDING, n2.stateTransition[e2] = 0) : n2.animationState[e2] === l3.LANDING ? (n2.stateTransition[e2] += i3, n2.stateTransition[e2] >= o2.landing.duration ? a2 = l4 ? l3.WALKING : l3.IDLE : a2 = l3.LANDING) : l4 ? (a2 = l3.WALKING, n2.phase[e2] += i3 * A * o2.frequency, n2.phase[e2] >= 1 && (n2.phase[e2] -= 1)) : a2 = l3.IDLE : v > 1 ? (a2 = l3.JUMPING, s3 !== l3.JUMPING && (n2.jumpTime[e2] = 0), n2.jumpTime[e2] += i3) : (a2 = l3.FALLING, s3 !== l3.FALLING && (n2.fallTime[e2] = 0), n2.fallTime[e2] += i3), n2.animationState[e2] = a2, a2) {
        case l3.WALKING:
          T(
            n2.leftArmEntity[e2],
            n2.rightArmEntity[e2],
            n2.leftLegEntity[e2],
            n2.rightLegEntity[e2],
            n2.phase[e2]
          );
          break;
        case l3.JUMPING:
          S(
            n2.headEntity[e2],
            n2.torsoEntity[e2],
            n2.leftArmEntity[e2],
            n2.rightArmEntity[e2],
            n2.leftLegEntity[e2],
            n2.rightLegEntity[e2],
            n2.jumpTime[e2]
          );
          break;
        case l3.FALLING:
          k(
            n2.headEntity[e2],
            n2.torsoEntity[e2],
            n2.leftArmEntity[e2],
            n2.rightArmEntity[e2],
            n2.leftLegEntity[e2],
            n2.rightLegEntity[e2],
            n2.fallTime[e2]
          );
          break;
        case l3.LANDING:
          D(
            n2.headEntity[e2],
            n2.torsoEntity[e2],
            n2.stateTransition[e2]
          );
          break;
        case l3.IDLE:
        default:
          T(
            n2.leftArmEntity[e2],
            n2.rightArmEntity[e2],
            n2.leftLegEntity[e2],
            n2.rightLegEntity[e2],
            0
          );
          break;
      }
    }
  }
};

// node_modules/vibegame/dist/plugins/startup/systems.js
var Z2 = defineQuery([s]);
var S2 = defineQuery([c]);
var L = defineQuery([t]);
var D2 = defineQuery([r]);
var R = defineQuery([t]);
var N2 = {
  group: "setup",
  update: (r3) => {
    const m3 = Z2(r3.world), o3 = S2(r3.world);
    if (m3.length === 0 && o3.length === 0) {
      const p3 = r3.createEntity();
      r3.addComponent(p3, c), r3.addComponent(p3, s);
    }
  }
};
var $ = {
  group: "setup",
  update: (r3) => {
    if (L(r3.world).length === 0) {
      const o3 = r3.createEntity();
      r3.addComponent(o3, t), r3.addComponent(o3, p), r3.addComponent(o3, r2), r3.addComponent(o3, c2), c2.type[o3] = p2.type, c2.mass[o3] = p2.mass, c2.posX[o3] = p2.posX, c2.posY[o3] = p2.posY, c2.posZ[o3] = p2.posZ, c2.eulerX[o3] = p2.eulerX, c2.eulerY[o3] = p2.eulerY, c2.eulerZ[o3] = p2.eulerZ, c2.rotX[o3] = 0, c2.rotY[o3] = 0, c2.rotZ[o3] = 0, c2.rotW[o3] = 1, c2.velX[o3] = p2.velX, c2.velY[o3] = p2.velY, c2.velZ[o3] = p2.velZ, c2.rotVelX[o3] = p2.rotVelX, c2.rotVelY[o3] = p2.rotVelY, c2.rotVelZ[o3] = p2.rotVelZ, c2.linearDamping[o3] = p2.linearDamping, c2.angularDamping[o3] = p2.angularDamping, c2.gravityScale[o3] = p2.gravityScale, c2.ccd[o3] = p2.ccd, c2.lockRotX[o3] = p2.lockRotX, c2.lockRotY[o3] = p2.lockRotY, c2.lockRotZ[o3] = p2.lockRotZ, r3.addComponent(o3, l), l.shape[o3] = l2.shape, l.radius[o3] = l2.radius, l.height[o3] = l2.height, l.sizeX[o3] = l2.sizeX, l.sizeY[o3] = l2.sizeY, l.sizeZ[o3] = l2.sizeZ, l.friction[o3] = l2.friction, l.restitution[o3] = l2.restitution, l.density[o3] = l2.density, l.isSensor[o3] = l2.isSensor, l.membershipGroups[o3] = l2.membershipGroups, l.filterGroups[o3] = l2.filterGroups, l.posOffsetX[o3] = l2.posOffsetX, l.posOffsetY[o3] = l2.posOffsetY, l.posOffsetZ[o3] = l2.posOffsetZ, l.rotOffsetX[o3] = l2.rotOffsetX, l.rotOffsetY[o3] = l2.rotOffsetY, l.rotOffsetZ[o3] = l2.rotOffsetZ, l.rotOffsetW[o3] = l2.rotOffsetW, r3.addComponent(o3, u), r3.addComponent(o3, i), r3.addComponent(o3, m2);
    }
  }
};
var oo = {
  group: "setup",
  update: (r3) => {
    if (D2(r3.world).length === 0) {
      const o3 = r3.createEntity();
      r3.addComponent(o3, i2), r3.addComponent(o3, r2), r3.addComponent(o3, r), r3.addComponent(o3, i), i2.inputSource[o3] = o3;
    }
  }
};
var ro = {
  group: "setup",
  update(r3) {
    const m3 = R(
      r3.world
    ).filter((o3) => !r3.hasComponent(o3, a));
    for (const o3 of m3) {
      const p3 = r3.createEntity();
      r3.addComponent(o3, a), r3.addComponent(p3, r2), r3.addComponent(p3, o), r3.addComponent(p3, n2), r2.posY[p3] = 0.75, o.entity[p3] = o3;
    }
  }
};

// node_modules/vibegame/dist/plugins/startup/plugin.js
var s2 = {
  systems: [
    N2,
    oo,
    $,
    ro
  ],
  components: {}
};

export {
  n2 as n,
  a,
  B,
  Q,
  s2 as s
};
//# sourceMappingURL=chunk-LZ7ZEFFY.js.map
