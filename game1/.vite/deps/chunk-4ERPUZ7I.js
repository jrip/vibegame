// node_modules/bitecs/dist/index.mjs
var TYPES_ENUM = {
  i8: "i8",
  ui8: "ui8",
  ui8c: "ui8c",
  i16: "i16",
  ui16: "ui16",
  i32: "i32",
  ui32: "ui32",
  f32: "f32",
  f64: "f64",
  eid: "eid"
};
var TYPES_NAMES = {
  i8: "Int8",
  ui8: "Uint8",
  ui8c: "Uint8Clamped",
  i16: "Int16",
  ui16: "Uint16",
  i32: "Int32",
  ui32: "Uint32",
  eid: "Uint32",
  f32: "Float32",
  f64: "Float64"
};
var TYPES = {
  i8: Int8Array,
  ui8: Uint8Array,
  ui8c: Uint8ClampedArray,
  i16: Int16Array,
  ui16: Uint16Array,
  i32: Int32Array,
  ui32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  eid: Uint32Array
};
var UNSIGNED_MAX = {
  uint8: 2 ** 8,
  uint16: 2 ** 16,
  uint32: 2 ** 32
};
var roundToMultiple = (mul) => (x8) => Math.ceil(x8 / mul) * mul;
var roundToMultiple4 = roundToMultiple(4);
var $storeRef = Symbol("storeRef");
var $storeSize = Symbol("storeSize");
var $storeMaps = Symbol("storeMaps");
var $storeFlattened = Symbol("storeFlattened");
var $storeBase = Symbol("storeBase");
var $storeType = Symbol("storeType");
var $storeArrayElementCounts = Symbol("storeArrayElementCounts");
var $storeSubarrays = Symbol("storeSubarrays");
var $subarrayCursors = Symbol("subarrayCursors");
var $subarray = Symbol("subarray");
var $subarrayFrom = Symbol("subarrayFrom");
var $subarrayTo = Symbol("subarrayTo");
var $parentArray = Symbol("parentArray");
var $tagStore = Symbol("tagStore");
var $queryShadow = Symbol("queryShadow");
var $serializeShadow = Symbol("serializeShadow");
var $indexType = Symbol("indexType");
var $indexBytes = Symbol("indexBytes");
var $isEidType = Symbol("isEidType");
var stores = {};
var createShadow = (store, key) => {
  if (!ArrayBuffer.isView(store)) {
    const shadowStore = store[$parentArray].slice(0);
    store[key] = store.map((_9, eid) => {
      const { length } = store[eid];
      const start = length * eid;
      const end = start + length;
      return shadowStore.subarray(start, end);
    });
  } else {
    store[key] = store.slice(0);
  }
};
var resetStoreFor = (store, eid) => {
  if (store[$storeFlattened]) {
    store[$storeFlattened].forEach((ta) => {
      if (ArrayBuffer.isView(ta))
        ta[eid] = 0;
      else
        ta[eid].fill(0);
    });
  }
};
var createTypeStore = (type, length) => {
  const totalBytes = length * TYPES[type].BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(totalBytes);
  const store = new TYPES[type](buffer);
  store[$isEidType] = type === TYPES_ENUM.eid;
  return store;
};
var createArrayStore = (metadata, type, length) => {
  const storeSize = metadata[$storeSize];
  const store = Array(storeSize).fill(0);
  store[$storeType] = type;
  store[$isEidType] = type === TYPES_ENUM.eid;
  const cursors = metadata[$subarrayCursors];
  const indexType = length <= UNSIGNED_MAX.uint8 ? TYPES_ENUM.ui8 : length <= UNSIGNED_MAX.uint16 ? TYPES_ENUM.ui16 : TYPES_ENUM.ui32;
  if (!length)
    throw new Error("bitECS - Must define component array length");
  if (!TYPES[type])
    throw new Error(`bitECS - Invalid component array property type ${type}`);
  if (!metadata[$storeSubarrays][type]) {
    const arrayElementCount = metadata[$storeArrayElementCounts][type];
    const array = new TYPES[type](roundToMultiple4(arrayElementCount * storeSize));
    array[$indexType] = TYPES_NAMES[indexType];
    array[$indexBytes] = TYPES[indexType].BYTES_PER_ELEMENT;
    metadata[$storeSubarrays][type] = array;
  }
  const start = cursors[type];
  const end = start + storeSize * length;
  cursors[type] = end;
  store[$parentArray] = metadata[$storeSubarrays][type].subarray(start, end);
  for (let eid = 0; eid < storeSize; eid++) {
    const start2 = length * eid;
    const end2 = start2 + length;
    store[eid] = store[$parentArray].subarray(start2, end2);
    store[eid][$indexType] = TYPES_NAMES[indexType];
    store[eid][$indexBytes] = TYPES[indexType].BYTES_PER_ELEMENT;
    store[eid][$subarray] = true;
  }
  return store;
};
var isArrayType = (x8) => Array.isArray(x8) && typeof x8[0] === "string" && typeof x8[1] === "number";
var createStore = (schema, size) => {
  const $store = Symbol("store");
  if (!schema || !Object.keys(schema).length) {
    stores[$store] = {
      [$storeSize]: size,
      [$tagStore]: true,
      [$storeBase]: () => stores[$store]
    };
    return stores[$store];
  }
  schema = JSON.parse(JSON.stringify(schema));
  const arrayElementCounts = {};
  const collectArrayElementCounts = (s4) => {
    const keys = Object.keys(s4);
    for (const k4 of keys) {
      if (isArrayType(s4[k4])) {
        if (!arrayElementCounts[s4[k4][0]])
          arrayElementCounts[s4[k4][0]] = 0;
        arrayElementCounts[s4[k4][0]] += s4[k4][1];
      } else if (s4[k4] instanceof Object) {
        collectArrayElementCounts(s4[k4]);
      }
    }
  };
  collectArrayElementCounts(schema);
  const metadata = {
    [$storeSize]: size,
    [$storeMaps]: {},
    [$storeSubarrays]: {},
    [$storeRef]: $store,
    [$subarrayCursors]: Object.keys(TYPES).reduce((a3, type) => ({ ...a3, [type]: 0 }), {}),
    [$storeFlattened]: [],
    [$storeArrayElementCounts]: arrayElementCounts
  };
  if (schema instanceof Object && Object.keys(schema).length) {
    const recursiveTransform = (a3, k4) => {
      if (typeof a3[k4] === "string") {
        a3[k4] = createTypeStore(a3[k4], size);
        a3[k4][$storeBase] = () => stores[$store];
        metadata[$storeFlattened].push(a3[k4]);
      } else if (isArrayType(a3[k4])) {
        const [type, length] = a3[k4];
        a3[k4] = createArrayStore(metadata, type, length);
        a3[k4][$storeBase] = () => stores[$store];
        metadata[$storeFlattened].push(a3[k4]);
      } else if (a3[k4] instanceof Object) {
        a3[k4] = Object.keys(a3[k4]).reduce(recursiveTransform, a3[k4]);
      }
      return a3;
    };
    stores[$store] = Object.assign(Object.keys(schema).reduce(recursiveTransform, schema), metadata);
    stores[$store][$storeBase] = () => stores[$store];
    return stores[$store];
  }
};
var SparseSet = () => {
  const dense = [];
  const sparse = [];
  dense.sort = function(comparator) {
    const result = Array.prototype.sort.call(this, comparator);
    for (let i3 = 0; i3 < dense.length; i3++) {
      sparse[dense[i3]] = i3;
    }
    return result;
  };
  const has = (val) => dense[sparse[val]] === val;
  const add = (val) => {
    if (has(val))
      return;
    sparse[val] = dense.push(val) - 1;
  };
  const remove = (val) => {
    if (!has(val))
      return;
    const index = sparse[val];
    const swapped = dense.pop();
    if (swapped !== val) {
      dense[index] = swapped;
      sparse[swapped] = index;
    }
  };
  const reset = () => {
    dense.length = 0;
    sparse.length = 0;
  };
  return {
    add,
    remove,
    has,
    sparse,
    dense,
    reset
  };
};
var not = (fn2) => (v7) => !fn2(v7);
var storeFlattened = (c6) => c6[$storeFlattened];
var isFullComponent = storeFlattened;
var isProperty = not(isFullComponent);
var isModifier = (c6) => typeof c6 === "function" && c6[$modifier];
var isNotModifier = not(isModifier);
var $entityMasks = Symbol("entityMasks");
var $entityComponents = Symbol("entityComponents");
var $entitySparseSet = Symbol("entitySparseSet");
var $entityArray = Symbol("entityArray");
var $entityIndices = Symbol("entityIndices");
var $removedEntities = Symbol("removedEntities");
var defaultSize = 1e5;
var globalEntityCursor = 0;
var globalSize = defaultSize;
var getGlobalSize = () => globalSize;
var removed = [];
var recycled = [];
var defaultRemovedReuseThreshold = 0.01;
var removedReuseThreshold = defaultRemovedReuseThreshold;
var getEntityCursor = () => globalEntityCursor;
var eidToWorld = /* @__PURE__ */ new Map();
var addEntity = (world) => {
  const eid = world[$manualEntityRecycling] ? removed.length ? removed.shift() : globalEntityCursor++ : removed.length > Math.round(globalSize * removedReuseThreshold) ? removed.shift() : globalEntityCursor++;
  if (eid > world[$size])
    throw new Error("bitECS - max entities reached");
  world[$entitySparseSet].add(eid);
  eidToWorld.set(eid, world);
  world[$notQueries].forEach((q3) => {
    const match = queryCheckEntity(world, q3, eid);
    if (match)
      queryAddEntity(q3, eid);
  });
  world[$entityComponents].set(eid, /* @__PURE__ */ new Set());
  return eid;
};
var removeEntity = (world, eid) => {
  if (!world[$entitySparseSet].has(eid))
    return;
  world[$queries].forEach((q3) => {
    queryRemoveEntity(world, q3, eid);
  });
  if (world[$manualEntityRecycling])
    recycled.push(eid);
  else
    removed.push(eid);
  world[$entitySparseSet].remove(eid);
  world[$entityComponents].delete(eid);
  world[$localEntities].delete(world[$localEntityLookup].get(eid));
  world[$localEntityLookup].delete(eid);
  for (let i3 = 0; i3 < world[$entityMasks].length; i3++)
    world[$entityMasks][i3][eid] = 0;
};
var entityExists = (world, eid) => world[$entitySparseSet].has(eid);
var $modifier = Symbol("$modifier");
function Any(...comps) {
  return function QueryAny() {
    return comps;
  };
}
function All(...comps) {
  return function QueryAll() {
    return comps;
  };
}
function None(...comps) {
  return function QueryNone() {
    return comps;
  };
}
var $queries = Symbol("queries");
var $notQueries = Symbol("notQueries");
var $queryAny = Symbol("queryAny");
var $queryAll = Symbol("queryAll");
var $queryNone = Symbol("queryNone");
var $queryMap = Symbol("queryMap");
var $dirtyQueries = Symbol("$dirtyQueries");
var $queryComponents = Symbol("queryComponents");
var $enterQuery = Symbol("enterQuery");
var $exitQuery = Symbol("exitQuery");
var empty = Object.freeze([]);
var registerQuery = (world, query) => {
  const components2 = [];
  const notComponents = [];
  const changedComponents = [];
  query[$queryComponents].forEach((c6) => {
    if (typeof c6 === "function" && c6[$modifier]) {
      const [comp, mod] = c6();
      if (!world[$componentMap].has(comp))
        registerComponent(world, comp);
      if (mod === "not") {
        notComponents.push(comp);
      }
      if (mod === "changed") {
        changedComponents.push(comp);
        components2.push(comp);
      }
    } else {
      if (!world[$componentMap].has(c6))
        registerComponent(world, c6);
      components2.push(c6);
    }
  });
  const mapComponents = (c6) => world[$componentMap].get(c6);
  const allComponents = components2.concat(notComponents).map(mapComponents);
  const sparseSet = SparseSet();
  const archetypes = [];
  const changed = [];
  const toRemove = SparseSet();
  const entered = SparseSet();
  const exited = SparseSet();
  const generations = allComponents.map((c6) => c6.generationId).reduce((a3, v7) => {
    if (a3.includes(v7))
      return a3;
    a3.push(v7);
    return a3;
  }, []);
  const reduceBitflags = (a3, c6) => {
    if (!a3[c6.generationId])
      a3[c6.generationId] = 0;
    a3[c6.generationId] |= c6.bitflag;
    return a3;
  };
  const masks = components2.map(mapComponents).reduce(reduceBitflags, {});
  const notMasks = notComponents.map(mapComponents).reduce(reduceBitflags, {});
  const hasMasks = allComponents.reduce(reduceBitflags, {});
  const flatProps = components2.filter((c6) => !c6[$tagStore]).map((c6) => Object.getOwnPropertySymbols(c6).includes($storeFlattened) ? c6[$storeFlattened] : [c6]).reduce((a3, v7) => a3.concat(v7), []);
  const shadows = [];
  const q3 = Object.assign(sparseSet, {
    archetypes,
    changed,
    components: components2,
    notComponents,
    changedComponents,
    allComponents,
    masks,
    notMasks,
    hasMasks,
    generations,
    flatProps,
    toRemove,
    entered,
    exited,
    shadows
  });
  world[$queryMap].set(query, q3);
  world[$queries].add(q3);
  allComponents.forEach((c6) => {
    c6.queries.add(q3);
  });
  if (notComponents.length)
    world[$notQueries].add(q3);
  for (let eid = 0; eid < getEntityCursor(); eid++) {
    if (!world[$entitySparseSet].has(eid))
      continue;
    const match = queryCheckEntity(world, q3, eid);
    if (match)
      queryAddEntity(q3, eid);
  }
};
var generateShadow = (q3, pid) => {
  const $7 = Symbol();
  const prop = q3.flatProps[pid];
  createShadow(prop, $7);
  q3.shadows[pid] = prop[$7];
  return prop[$7];
};
var diff = (q3, clearDiff) => {
  if (clearDiff)
    q3.changed = [];
  const { flatProps, shadows } = q3;
  for (let i3 = 0; i3 < q3.dense.length; i3++) {
    const eid = q3.dense[i3];
    let dirty = false;
    for (let pid = 0; pid < flatProps.length; pid++) {
      const prop = flatProps[pid];
      const shadow = shadows[pid] || generateShadow(q3, pid);
      if (ArrayBuffer.isView(prop[eid])) {
        for (let i22 = 0; i22 < prop[eid].length; i22++) {
          if (prop[eid][i22] !== shadow[eid][i22]) {
            dirty = true;
            break;
          }
        }
        shadow[eid].set(prop[eid]);
      } else {
        if (prop[eid] !== shadow[eid]) {
          dirty = true;
          shadow[eid] = prop[eid];
        }
      }
    }
    if (dirty)
      q3.changed.push(eid);
  }
  return q3.changed;
};
var flatten = (a3, v7) => a3.concat(v7);
var aggregateComponentsFor = (mod) => (x8) => x8.filter((f6) => f6.name === mod().constructor.name).reduce(flatten);
var getAnyComponents = aggregateComponentsFor(Any);
var getAllComponents = aggregateComponentsFor(All);
var getNoneComponents = aggregateComponentsFor(None);
var defineQuery = (...args) => {
  let components2;
  let any, all, none;
  if (Array.isArray(args[0])) {
    components2 = args[0];
  } else {
  }
  if (components2 === void 0 || components2[$componentMap] !== void 0) {
    return (world) => world ? world[$entityArray] : components2[$entityArray];
  }
  const query = function(world, clearDiff = true) {
    if (!world[$queryMap].has(query))
      registerQuery(world, query);
    const q3 = world[$queryMap].get(query);
    commitRemovals(world);
    if (q3.changedComponents.length)
      return diff(q3, clearDiff);
    return q3.dense;
  };
  query[$queryComponents] = components2;
  query[$queryAny] = any;
  query[$queryAll] = all;
  query[$queryNone] = none;
  return query;
};
var queryCheckEntity = (world, q3, eid) => {
  const { masks, notMasks, generations } = q3;
  let or = 0;
  for (let i3 = 0; i3 < generations.length; i3++) {
    const generationId = generations[i3];
    const qMask = masks[generationId];
    const qNotMask = notMasks[generationId];
    const eMask = world[$entityMasks][generationId][eid];
    if (qNotMask && (eMask & qNotMask) !== 0) {
      return false;
    }
    if (qMask && (eMask & qMask) !== qMask) {
      return false;
    }
  }
  return true;
};
var queryAddEntity = (q3, eid) => {
  q3.toRemove.remove(eid);
  q3.entered.add(eid);
  q3.add(eid);
};
var queryCommitRemovals = (q3) => {
  for (let i3 = q3.toRemove.dense.length - 1; i3 >= 0; i3--) {
    const eid = q3.toRemove.dense[i3];
    q3.toRemove.remove(eid);
    q3.remove(eid);
  }
};
var commitRemovals = (world) => {
  if (!world[$dirtyQueries].size)
    return;
  world[$dirtyQueries].forEach(queryCommitRemovals);
  world[$dirtyQueries].clear();
};
var queryRemoveEntity = (world, q3, eid) => {
  if (!q3.has(eid) || q3.toRemove.has(eid))
    return;
  q3.toRemove.add(eid);
  world[$dirtyQueries].add(q3);
  q3.exited.add(eid);
};
var $componentMap = Symbol("componentMap");
var components = [];
var defineComponent = (schema, size) => {
  const component = createStore(schema, size || getGlobalSize());
  if (schema && Object.keys(schema).length)
    components.push(component);
  return component;
};
var incrementBitflag = (world) => {
  world[$bitflag] *= 2;
  if (world[$bitflag] >= 2 ** 31) {
    world[$bitflag] = 1;
    world[$entityMasks].push(new Uint32Array(world[$size]));
  }
};
var registerComponent = (world, component) => {
  if (!component)
    throw new Error(`bitECS - Cannot register null or undefined component`);
  const queries = /* @__PURE__ */ new Set();
  const notQueries = /* @__PURE__ */ new Set();
  const changedQueries = /* @__PURE__ */ new Set();
  world[$queries].forEach((q3) => {
    if (q3.allComponents.includes(component)) {
      queries.add(q3);
    }
  });
  world[$componentMap].set(component, {
    generationId: world[$entityMasks].length - 1,
    bitflag: world[$bitflag],
    store: component,
    queries,
    notQueries,
    changedQueries
  });
  incrementBitflag(world);
};
var hasComponent = (world, component, eid) => {
  const registeredComponent = world[$componentMap].get(component);
  if (!registeredComponent)
    return false;
  const { generationId, bitflag } = registeredComponent;
  const mask = world[$entityMasks][generationId][eid];
  return (mask & bitflag) === bitflag;
};
var addComponent = (world, component, eid, reset = false) => {
  if (eid === void 0)
    throw new Error("bitECS - entity is undefined.");
  if (!world[$entitySparseSet].has(eid))
    throw new Error("bitECS - entity does not exist in the world.");
  if (!world[$componentMap].has(component))
    registerComponent(world, component);
  if (hasComponent(world, component, eid))
    return;
  const c6 = world[$componentMap].get(component);
  const { generationId, bitflag, queries, notQueries } = c6;
  world[$entityMasks][generationId][eid] |= bitflag;
  queries.forEach((q3) => {
    q3.toRemove.remove(eid);
    const match = queryCheckEntity(world, q3, eid);
    if (match) {
      q3.exited.remove(eid);
      queryAddEntity(q3, eid);
    }
    if (!match) {
      q3.entered.remove(eid);
      queryRemoveEntity(world, q3, eid);
    }
  });
  world[$entityComponents].get(eid).add(component);
  if (reset)
    resetStoreFor(component, eid);
};
var removeComponent = (world, component, eid, reset = true) => {
  if (eid === void 0)
    throw new Error("bitECS - entity is undefined.");
  if (!world[$entitySparseSet].has(eid))
    throw new Error("bitECS - entity does not exist in the world.");
  if (!hasComponent(world, component, eid))
    return;
  const c6 = world[$componentMap].get(component);
  const { generationId, bitflag, queries } = c6;
  world[$entityMasks][generationId][eid] &= ~bitflag;
  queries.forEach((q3) => {
    q3.toRemove.remove(eid);
    const match = queryCheckEntity(world, q3, eid);
    if (match) {
      q3.exited.remove(eid);
      queryAddEntity(q3, eid);
    }
    if (!match) {
      q3.entered.remove(eid);
      queryRemoveEntity(world, q3, eid);
    }
  });
  world[$entityComponents].get(eid).delete(component);
  if (reset)
    resetStoreFor(component, eid);
};
var $size = Symbol("size");
var $resizeThreshold = Symbol("resizeThreshold");
var $bitflag = Symbol("bitflag");
var $archetypes = Symbol("archetypes");
var $localEntities = Symbol("localEntities");
var $localEntityLookup = Symbol("localEntityLookup");
var $manualEntityRecycling = Symbol("manualEntityRecycling");
var worlds = [];
var createWorld = (...args) => {
  const world = typeof args[0] === "object" ? args[0] : {};
  const size = typeof args[0] === "number" ? args[0] : typeof args[1] === "number" ? args[1] : getGlobalSize();
  resetWorld(world, size);
  worlds.push(world);
  return world;
};
var resetWorld = (world, size = getGlobalSize()) => {
  world[$size] = size;
  if (world[$entityArray])
    world[$entityArray].forEach((eid) => removeEntity(world, eid));
  world[$entityMasks] = [new Uint32Array(size)];
  world[$entityComponents] = /* @__PURE__ */ new Map();
  world[$archetypes] = [];
  world[$entitySparseSet] = SparseSet();
  world[$entityArray] = world[$entitySparseSet].dense;
  world[$bitflag] = 1;
  world[$componentMap] = /* @__PURE__ */ new Map();
  world[$queryMap] = /* @__PURE__ */ new Map();
  world[$queries] = /* @__PURE__ */ new Set();
  world[$notQueries] = /* @__PURE__ */ new Set();
  world[$dirtyQueries] = /* @__PURE__ */ new Set();
  world[$localEntities] = /* @__PURE__ */ new Map();
  world[$localEntityLookup] = /* @__PURE__ */ new Map();
  world[$manualEntityRecycling] = false;
  return world;
};
var Types = TYPES_ENUM;

// node_modules/vibegame/dist/core/ecs/components.js
var o = defineComponent({
  entity: Types.i32
});

// node_modules/vibegame/dist/node_modules/zod/v4/core/core.js
function l(r4, i3, c6) {
  function a3(e, t3) {
    var n3;
    Object.defineProperty(e, "_zod", {
      value: e._zod ?? {},
      enumerable: false
    }), (n3 = e._zod).traits ?? (n3.traits = /* @__PURE__ */ new Set()), e._zod.traits.add(r4), i3(e, t3);
    for (const d7 in o3.prototype)
      d7 in e || Object.defineProperty(e, d7, { value: o3.prototype[d7].bind(e) });
    e._zod.constr = o3, e._zod.def = t3;
  }
  const u5 = (c6 == null ? void 0 : c6.Parent) ?? Object;
  class s4 extends u5 {
  }
  Object.defineProperty(s4, "name", { value: r4 });
  function o3(e) {
    var t3;
    const n3 = (c6 == null ? void 0 : c6.Parent) ? new s4() : this;
    a3(n3, e), (t3 = n3._zod).deferred ?? (t3.deferred = []);
    for (const d7 of n3._zod.deferred)
      d7();
    return n3;
  }
  return Object.defineProperty(o3, "init", { value: a3 }), Object.defineProperty(o3, Symbol.hasInstance, {
    value: (e) => {
      var _a, _b;
      return (c6 == null ? void 0 : c6.Parent) && e instanceof c6.Parent ? true : (_b = (_a = e == null ? void 0 : e._zod) == null ? void 0 : _a.traits) == null ? void 0 : _b.has(r4);
    }
  }), Object.defineProperty(o3, "name", { value: r4 }), o3;
}
var p = class extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
};
var y = class extends Error {
  constructor(i3) {
    super(`Encountered unidirectional transform during encode: ${i3}`), this.name = "ZodEncodeError";
  }
};
var f = {};
function P(r4) {
  return f;
}

// node_modules/vibegame/dist/node_modules/zod/v4/core/util.js
function _(e) {
  const t3 = Object.values(e).filter((r4) => typeof r4 == "number");
  return Object.entries(e).filter(([r4, o3]) => t3.indexOf(+r4) === -1).map(([r4, o3]) => o3);
}
function b(e, t3) {
  return typeof t3 == "bigint" ? t3.toString() : t3;
}
function y2(e) {
  return {
    get value() {
      {
        const t3 = e();
        return Object.defineProperty(this, "value", { value: t3 }), t3;
      }
    }
  };
}
function w(e) {
  return e == null;
}
function z(e) {
  const t3 = e.startsWith("^") ? 1 : 0, n3 = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(t3, n3);
}
function E(e, t3) {
  const n3 = (e.toString().split(".")[1] || "").length, r4 = t3.toString();
  let o3 = (r4.split(".")[1] || "").length;
  if (o3 === 0 && /\d?e-\d?/.test(r4)) {
    const p7 = r4.match(/\d?e-(\d?)/);
    (p7 == null ? void 0 : p7[1]) && (o3 = Number.parseInt(p7[1]));
  }
  const i3 = n3 > o3 ? n3 : o3, s4 = Number.parseInt(e.toFixed(i3).replace(".", "")), g8 = Number.parseInt(t3.toFixed(i3).replace(".", ""));
  return s4 % g8 / 10 ** i3;
}
var l2 = Symbol("evaluating");
function O(e, t3, n3) {
  let r4;
  Object.defineProperty(e, t3, {
    get() {
      if (r4 !== l2)
        return r4 === void 0 && (r4 = l2, r4 = n3()), r4;
    },
    set(o3) {
      Object.defineProperty(e, t3, {
        value: o3
        // configurable: true,
      });
    },
    configurable: true
  });
}
function c(e, t3, n3) {
  Object.defineProperty(e, t3, {
    value: n3,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function f2(...e) {
  const t3 = {};
  for (const n3 of e) {
    const r4 = Object.getOwnPropertyDescriptors(n3);
    Object.assign(t3, r4);
  }
  return Object.defineProperties({}, t3);
}
function k(e) {
  return JSON.stringify(e);
}
var S = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function h(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
var A = y2(() => {
  var _a;
  if (typeof navigator < "u" && ((_a = navigator == null ? void 0 : navigator.userAgent) == null ? void 0 : _a.includes("Cloudflare")))
    return false;
  try {
    const e = Function;
    return new e(""), true;
  } catch {
    return false;
  }
});
function d(e) {
  if (h(e) === false)
    return false;
  const t3 = e.constructor;
  if (t3 === void 0)
    return true;
  const n3 = t3.prototype;
  return !(h(n3) === false || Object.prototype.hasOwnProperty.call(n3, "isPrototypeOf") === false);
}
function j(e) {
  return d(e) ? { ...e } : Array.isArray(e) ? [...e] : e;
}
var m = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function v(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function u(e, t3, n3) {
  const r4 = new e._zod.constr(t3 ?? e._zod.def);
  return (!t3 || (n3 == null ? void 0 : n3.parent)) && (r4._zod.parent = e), r4;
}
function I(e) {
  const t3 = e;
  if (!t3)
    return {};
  if (typeof t3 == "string")
    return { error: () => t3 };
  if ((t3 == null ? void 0 : t3.message) !== void 0) {
    if ((t3 == null ? void 0 : t3.error) !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    t3.error = t3.message;
  }
  return delete t3.message, typeof t3.error == "string" ? { ...t3, error: () => t3.error } : t3;
}
function N(e) {
  return Object.keys(e).filter((t3) => e[t3]._zod.optin === "optional" && e[t3]._zod.optout === "optional");
}
var x = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function T(e, t3) {
  const n3 = e._zod.def, r4 = f2(e._zod.def, {
    get shape() {
      const o3 = {};
      for (const i3 in t3) {
        if (!(i3 in n3.shape))
          throw new Error(`Unrecognized key: "${i3}"`);
        t3[i3] && (o3[i3] = n3.shape[i3]);
      }
      return c(this, "shape", o3), o3;
    },
    checks: []
  });
  return u(e, r4);
}
function P2(e, t3) {
  const n3 = e._zod.def, r4 = f2(e._zod.def, {
    get shape() {
      const o3 = { ...e._zod.def.shape };
      for (const i3 in t3) {
        if (!(i3 in n3.shape))
          throw new Error(`Unrecognized key: "${i3}"`);
        t3[i3] && delete o3[i3];
      }
      return c(this, "shape", o3), o3;
    },
    checks: []
  });
  return u(e, r4);
}
function R(e, t3) {
  if (!d(t3))
    throw new Error("Invalid input to extend: expected a plain object");
  const n3 = e._zod.def.checks;
  if (n3 && n3.length > 0)
    throw new Error("Object schemas containing refinements cannot be extended. Use `.safeExtend()` instead.");
  const o3 = f2(e._zod.def, {
    get shape() {
      const i3 = { ...e._zod.def.shape, ...t3 };
      return c(this, "shape", i3), i3;
    },
    checks: []
  });
  return u(e, o3);
}
function U(e, t3) {
  if (!d(t3))
    throw new Error("Invalid input to safeExtend: expected a plain object");
  const n3 = {
    ...e._zod.def,
    get shape() {
      const r4 = { ...e._zod.def.shape, ...t3 };
      return c(this, "shape", r4), r4;
    },
    checks: e._zod.def.checks
  };
  return u(e, n3);
}
function D(e, t3) {
  const n3 = f2(e._zod.def, {
    get shape() {
      const r4 = { ...e._zod.def.shape, ...t3._zod.def.shape };
      return c(this, "shape", r4), r4;
    },
    get catchall() {
      return t3._zod.def.catchall;
    },
    checks: []
    // delete existing checks
  });
  return u(e, n3);
}
function F(e, t3, n3) {
  const r4 = f2(t3._zod.def, {
    get shape() {
      const o3 = t3._zod.def.shape, i3 = { ...o3 };
      if (n3)
        for (const s4 in n3) {
          if (!(s4 in o3))
            throw new Error(`Unrecognized key: "${s4}"`);
          n3[s4] && (i3[s4] = e ? new e({
            type: "optional",
            innerType: o3[s4]
          }) : o3[s4]);
        }
      else
        for (const s4 in o3)
          i3[s4] = e ? new e({
            type: "optional",
            innerType: o3[s4]
          }) : o3[s4];
      return c(this, "shape", i3), i3;
    },
    checks: []
  });
  return u(t3, r4);
}
function M(e, t3, n3) {
  const r4 = f2(t3._zod.def, {
    get shape() {
      const o3 = t3._zod.def.shape, i3 = { ...o3 };
      if (n3)
        for (const s4 in n3) {
          if (!(s4 in i3))
            throw new Error(`Unrecognized key: "${s4}"`);
          n3[s4] && (i3[s4] = new e({
            type: "nonoptional",
            innerType: o3[s4]
          }));
        }
      else
        for (const s4 in o3)
          i3[s4] = new e({
            type: "nonoptional",
            innerType: o3[s4]
          });
      return c(this, "shape", i3), i3;
    },
    checks: []
  });
  return u(t3, r4);
}
function $(e, t3 = 0) {
  var _a;
  if (e.aborted === true)
    return true;
  for (let n3 = t3; n3 < e.issues.length; n3++)
    if (((_a = e.issues[n3]) == null ? void 0 : _a.continue) !== true)
      return true;
  return false;
}
function L(e, t3) {
  return t3.map((n3) => {
    var r4;
    return (r4 = n3).path ?? (r4.path = []), n3.path.unshift(e), n3;
  });
}
function a(e) {
  return typeof e == "string" ? e : e == null ? void 0 : e.message;
}
function V(e, t3, n3) {
  var _a, _b, _c2, _d, _e, _f;
  const r4 = { ...e, path: e.path ?? [] };
  if (!e.message) {
    const o3 = a((_c2 = (_b = (_a = e.inst) == null ? void 0 : _a._zod.def) == null ? void 0 : _b.error) == null ? void 0 : _c2.call(_b, e)) ?? a((_d = t3 == null ? void 0 : t3.error) == null ? void 0 : _d.call(t3, e)) ?? a((_e = n3.customError) == null ? void 0 : _e.call(n3, e)) ?? a((_f = n3.localeError) == null ? void 0 : _f.call(n3, e)) ?? "Invalid input";
    r4.message = o3;
  }
  return delete r4.inst, delete r4.continue, (t3 == null ? void 0 : t3.reportInput) || delete r4.input, r4;
}
function C(e) {
  return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function G(...e) {
  const [t3, n3, r4] = e;
  return typeof t3 == "string" ? {
    message: t3,
    code: "custom",
    input: n3,
    inst: r4
  } : { ...t3 };
}

// node_modules/vibegame/dist/node_modules/zod/v4/core/regexes.js
var c2 = /^[cC][^\s-]{8,}$/;
var d2 = /^[0-9a-z]+$/;
var i = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var s = /^[0-9a-vA-V]{20}$/;
var $2 = /^[A-Za-z0-9]{27}$/;
var F2 = /^[a-zA-Z0-9_-]{21}$/;
var u2 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var r = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var p2 = (f6) => f6 ? new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${f6}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
var m2 = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var A2 = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function z2() {
  return new RegExp(A2, "u");
}
var Z = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var x2 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var g = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var l3 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var E2 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var b2 = /^[A-Za-z0-9_-]*$/;
var h2 = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var w2 = /^\+(?:[0-9]){6,14}[0-9]$/;
var a2 = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
var R2 = new RegExp(`^${a2}$`);
function t(f6) {
  const n3 = "(?:[01]\\d|2[0-3]):[0-5]\\d";
  return typeof f6.precision == "number" ? f6.precision === -1 ? `${n3}` : f6.precision === 0 ? `${n3}:[0-5]\\d` : `${n3}:[0-5]\\d\\.\\d{${f6.precision}}` : `${n3}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function _2(f6) {
  return new RegExp(`^${t(f6)}$`);
}
function j2(f6) {
  const n3 = t({ precision: f6.precision }), e = ["Z"];
  f6.local && e.push(""), f6.offset && e.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
  const o3 = `${n3}(?:${e.join("|")})`;
  return new RegExp(`^${a2}T(?:${o3})$`);
}
var v2 = (f6) => {
  const n3 = f6 ? `[\\s\\S]{${(f6 == null ? void 0 : f6.minimum) ?? 0},${(f6 == null ? void 0 : f6.maximum) ?? ""}}` : "[\\s\\S]*";
  return new RegExp(`^${n3}$`);
};
var S2 = /^-?\d+$/;
var T2 = /^-?\d+(?:\.\d+)?/;
var M2 = /^(?:true|false)$/i;
var P3 = /^[^A-Z]*$/;
var k2 = /^[^a-z]*$/;

// node_modules/vibegame/dist/node_modules/zod/v4/core/checks.js
var s2 = l("$ZodCheck", (e, t3) => {
  var o3;
  e._zod ?? (e._zod = {}), e._zod.def = t3, (o3 = e._zod).onattach ?? (o3.onattach = []);
});
var v3 = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var Z2 = l("$ZodCheckLessThan", (e, t3) => {
  s2.init(e, t3);
  const o3 = v3[typeof t3.value];
  e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag, u5 = (t3.inclusive ? i3.maximum : i3.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    t3.value < u5 && (t3.inclusive ? i3.maximum = t3.value : i3.exclusiveMaximum = t3.value);
  }), e._zod.check = (n3) => {
    (t3.inclusive ? n3.value <= t3.value : n3.value < t3.value) || n3.issues.push({
      origin: o3,
      code: "too_big",
      maximum: t3.value,
      input: n3.value,
      inclusive: t3.inclusive,
      inst: e,
      continue: !t3.abort
    });
  };
});
var I2 = l("$ZodCheckGreaterThan", (e, t3) => {
  s2.init(e, t3);
  const o3 = v3[typeof t3.value];
  e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag, u5 = (t3.inclusive ? i3.minimum : i3.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    t3.value > u5 && (t3.inclusive ? i3.minimum = t3.value : i3.exclusiveMinimum = t3.value);
  }), e._zod.check = (n3) => {
    (t3.inclusive ? n3.value >= t3.value : n3.value > t3.value) || n3.issues.push({
      origin: o3,
      code: "too_small",
      minimum: t3.value,
      input: n3.value,
      inclusive: t3.inclusive,
      inst: e,
      continue: !t3.abort
    });
  };
});
var N2 = l("$ZodCheckMultipleOf", (e, t3) => {
  s2.init(e, t3), e._zod.onattach.push((o3) => {
    var n3;
    (n3 = o3._zod.bag).multipleOf ?? (n3.multipleOf = t3.value);
  }), e._zod.check = (o3) => {
    if (typeof o3.value != typeof t3.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    (typeof o3.value == "bigint" ? o3.value % t3.value === BigInt(0) : E(o3.value, t3.value) === 0) || o3.issues.push({
      origin: typeof o3.value,
      code: "not_multiple_of",
      divisor: t3.value,
      input: o3.value,
      inst: e,
      continue: !t3.abort
    });
  };
});
var w3 = l("$ZodCheckNumberFormat", (e, t3) => {
  var _a;
  s2.init(e, t3), t3.format = t3.format || "float64";
  const o3 = (_a = t3.format) == null ? void 0 : _a.includes("int"), n3 = o3 ? "int" : "number", [i3, u5] = x[t3.format];
  e._zod.onattach.push((a3) => {
    const r4 = a3._zod.bag;
    r4.format = t3.format, r4.minimum = i3, r4.maximum = u5, o3 && (r4.pattern = S2);
  }), e._zod.check = (a3) => {
    const r4 = a3.value;
    if (o3) {
      if (!Number.isInteger(r4)) {
        a3.issues.push({
          expected: n3,
          format: t3.format,
          code: "invalid_type",
          continue: false,
          input: r4,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(r4)) {
        r4 > 0 ? a3.issues.push({
          input: r4,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: n3,
          continue: !t3.abort
        }) : a3.issues.push({
          input: r4,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: n3,
          continue: !t3.abort
        });
        return;
      }
    }
    r4 < i3 && a3.issues.push({
      origin: "number",
      input: r4,
      code: "too_small",
      minimum: i3,
      inclusive: true,
      inst: e,
      continue: !t3.abort
    }), r4 > u5 && a3.issues.push({
      origin: "number",
      input: r4,
      code: "too_big",
      maximum: u5,
      inst: e
    });
  };
});
var E3 = l("$ZodCheckMaxLength", (e, t3) => {
  var o3;
  s2.init(e, t3), (o3 = e._zod.def).when ?? (o3.when = (n3) => {
    const i3 = n3.value;
    return !w(i3) && i3.length !== void 0;
  }), e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    t3.maximum < i3 && (n3._zod.bag.maximum = t3.maximum);
  }), e._zod.check = (n3) => {
    const i3 = n3.value;
    if (i3.length <= t3.maximum)
      return;
    const a3 = C(i3);
    n3.issues.push({
      origin: a3,
      code: "too_big",
      maximum: t3.maximum,
      inclusive: true,
      input: i3,
      inst: e,
      continue: !t3.abort
    });
  };
});
var M3 = l("$ZodCheckMinLength", (e, t3) => {
  var o3;
  s2.init(e, t3), (o3 = e._zod.def).when ?? (o3.when = (n3) => {
    const i3 = n3.value;
    return !w(i3) && i3.length !== void 0;
  }), e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    t3.minimum > i3 && (n3._zod.bag.minimum = t3.minimum);
  }), e._zod.check = (n3) => {
    const i3 = n3.value;
    if (i3.length >= t3.minimum)
      return;
    const a3 = C(i3);
    n3.issues.push({
      origin: a3,
      code: "too_small",
      minimum: t3.minimum,
      inclusive: true,
      input: i3,
      inst: e,
      continue: !t3.abort
    });
  };
});
var S3 = l("$ZodCheckLengthEquals", (e, t3) => {
  var o3;
  s2.init(e, t3), (o3 = e._zod.def).when ?? (o3.when = (n3) => {
    const i3 = n3.value;
    return !w(i3) && i3.length !== void 0;
  }), e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag;
    i3.minimum = t3.length, i3.maximum = t3.length, i3.length = t3.length;
  }), e._zod.check = (n3) => {
    const i3 = n3.value, u5 = i3.length;
    if (u5 === t3.length)
      return;
    const a3 = C(i3), r4 = u5 > t3.length;
    n3.issues.push({
      origin: a3,
      ...r4 ? { code: "too_big", maximum: t3.length } : { code: "too_small", minimum: t3.length },
      inclusive: true,
      exact: true,
      input: n3.value,
      inst: e,
      continue: !t3.abort
    });
  };
});
var g2 = l("$ZodCheckStringFormat", (e, t3) => {
  var o3, n3;
  s2.init(e, t3), e._zod.onattach.push((i3) => {
    const u5 = i3._zod.bag;
    u5.format = t3.format, t3.pattern && (u5.patterns ?? (u5.patterns = /* @__PURE__ */ new Set()), u5.patterns.add(t3.pattern));
  }), t3.pattern ? (o3 = e._zod).check ?? (o3.check = (i3) => {
    t3.pattern.lastIndex = 0, !t3.pattern.test(i3.value) && i3.issues.push({
      origin: "string",
      code: "invalid_format",
      format: t3.format,
      input: i3.value,
      ...t3.pattern ? { pattern: t3.pattern.toString() } : {},
      inst: e,
      continue: !t3.abort
    });
  }) : (n3 = e._zod).check ?? (n3.check = () => {
  });
});
var T3 = l("$ZodCheckRegex", (e, t3) => {
  g2.init(e, t3), e._zod.check = (o3) => {
    t3.pattern.lastIndex = 0, !t3.pattern.test(o3.value) && o3.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: o3.value,
      pattern: t3.pattern.toString(),
      inst: e,
      continue: !t3.abort
    });
  };
});
var R3 = l("$ZodCheckLowerCase", (e, t3) => {
  t3.pattern ?? (t3.pattern = P3), g2.init(e, t3);
});
var d3 = l("$ZodCheckUpperCase", (e, t3) => {
  t3.pattern ?? (t3.pattern = k2), g2.init(e, t3);
});
var F3 = l("$ZodCheckIncludes", (e, t3) => {
  s2.init(e, t3);
  const o3 = v(t3.includes), n3 = new RegExp(typeof t3.position == "number" ? `^.{${t3.position}}${o3}` : o3);
  t3.pattern = n3, e._zod.onattach.push((i3) => {
    const u5 = i3._zod.bag;
    u5.patterns ?? (u5.patterns = /* @__PURE__ */ new Set()), u5.patterns.add(n3);
  }), e._zod.check = (i3) => {
    i3.value.includes(t3.includes, t3.position) || i3.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: t3.includes,
      input: i3.value,
      inst: e,
      continue: !t3.abort
    });
  };
});
var L2 = l("$ZodCheckStartsWith", (e, t3) => {
  s2.init(e, t3);
  const o3 = new RegExp(`^${v(t3.prefix)}.*`);
  t3.pattern ?? (t3.pattern = o3), e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag;
    i3.patterns ?? (i3.patterns = /* @__PURE__ */ new Set()), i3.patterns.add(o3);
  }), e._zod.check = (n3) => {
    n3.value.startsWith(t3.prefix) || n3.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: t3.prefix,
      input: n3.value,
      inst: e,
      continue: !t3.abort
    });
  };
});
var O2 = l("$ZodCheckEndsWith", (e, t3) => {
  s2.init(e, t3);
  const o3 = new RegExp(`.*${v(t3.suffix)}$`);
  t3.pattern ?? (t3.pattern = o3), e._zod.onattach.push((n3) => {
    const i3 = n3._zod.bag;
    i3.patterns ?? (i3.patterns = /* @__PURE__ */ new Set()), i3.patterns.add(o3);
  }), e._zod.check = (n3) => {
    n3.value.endsWith(t3.suffix) || n3.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: t3.suffix,
      input: n3.value,
      inst: e,
      continue: !t3.abort
    });
  };
});
var A3 = l("$ZodCheckOverwrite", (e, t3) => {
  s2.init(e, t3), e._zod.check = (o3) => {
    o3.value = t3.tx(o3.value);
  };
});

// node_modules/vibegame/dist/node_modules/zod/v4/core/doc.js
var h3 = class {
  constructor(t3 = []) {
    this.content = [], this.indent = 0, this && (this.args = t3);
  }
  indented(t3) {
    this.indent += 1, t3(this), this.indent -= 1;
  }
  write(t3) {
    if (typeof t3 == "function") {
      t3(this, { execution: "sync" }), t3(this, { execution: "async" });
      return;
    }
    const e = t3.split(`
`).filter((n3) => n3), i3 = Math.min(...e.map((n3) => n3.length - n3.trimStart().length)), s4 = e.map((n3) => n3.slice(i3)).map((n3) => " ".repeat(this.indent * 2) + n3);
    for (const n3 of s4)
      this.content.push(n3);
  }
  compile() {
    const t3 = Function, o3 = this == null ? void 0 : this.args, i3 = [...((this == null ? void 0 : this.content) ?? [""]).map((s4) => `  ${s4}`)];
    return new t3(...o3, i3.join(`
`));
  }
};

// node_modules/vibegame/dist/node_modules/zod/v4/core/errors.js
var u3 = (s4, t3) => {
  s4.name = "$ZodError", Object.defineProperty(s4, "_zod", {
    value: s4._zod,
    enumerable: false
  }), Object.defineProperty(s4, "issues", {
    value: t3,
    enumerable: false
  }), s4.message = JSON.stringify(t3, b, 2), Object.defineProperty(s4, "toString", {
    value: () => s4.message,
    enumerable: false
  });
};
var m3 = l("$ZodError", u3);
var g3 = l("$ZodError", u3, { Parent: Error });
function E4(s4, t3 = (r4) => r4.message) {
  const r4 = {}, i3 = [];
  for (const n3 of s4.issues)
    n3.path.length > 0 ? (r4[n3.path[0]] = r4[n3.path[0]] || [], r4[n3.path[0]].push(t3(n3))) : i3.push(t3(n3));
  return { formErrors: i3, fieldErrors: r4 };
}
function _3(s4, t3 = (r4) => r4.message) {
  const r4 = { _errors: [] }, i3 = (n3) => {
    for (const e of n3.issues)
      if (e.code === "invalid_union" && e.errors.length)
        e.errors.map((o3) => i3({ issues: o3 }));
      else if (e.code === "invalid_key")
        i3({ issues: e.issues });
      else if (e.code === "invalid_element")
        i3({ issues: e.issues });
      else if (e.path.length === 0)
        r4._errors.push(t3(e));
      else {
        let o3 = r4, a3 = 0;
        for (; a3 < e.path.length; ) {
          const l6 = e.path[a3];
          a3 === e.path.length - 1 ? (o3[l6] = o3[l6] || { _errors: [] }, o3[l6]._errors.push(t3(e))) : o3[l6] = o3[l6] || { _errors: [] }, o3 = o3[l6], a3++;
        }
      }
  };
  return i3(s4), r4;
}

// node_modules/vibegame/dist/node_modules/zod/v4/core/parse.js
var g4 = (e) => (n3, c6, s4, r4) => {
  const t3 = s4 ? Object.assign(s4, { async: false }) : { async: false }, a3 = n3._zod.run({ value: c6, issues: [] }, t3);
  if (a3 instanceof Promise)
    throw new p();
  if (a3.issues.length) {
    const o3 = new ((r4 == null ? void 0 : r4.Err) ?? e)(a3.issues.map((d7) => V(d7, t3, P())));
    throw S(o3, r4 == null ? void 0 : r4.callee), o3;
  }
  return a3.value;
};
var m4 = (e) => async (n3, c6, s4, r4) => {
  const t3 = s4 ? Object.assign(s4, { async: true }) : { async: true };
  let a3 = n3._zod.run({ value: c6, issues: [] }, t3);
  if (a3 instanceof Promise && (a3 = await a3), a3.issues.length) {
    const o3 = new ((r4 == null ? void 0 : r4.Err) ?? e)(a3.issues.map((d7) => V(d7, t3, P())));
    throw S(o3, r4 == null ? void 0 : r4.callee), o3;
  }
  return a3.value;
};
var f3 = (e) => (n3, c6, s4) => {
  const r4 = s4 ? { ...s4, async: false } : { async: false }, t3 = n3._zod.run({ value: c6, issues: [] }, r4);
  if (t3 instanceof Promise)
    throw new p();
  return t3.issues.length ? {
    success: false,
    error: new (e ?? m3)(t3.issues.map((a3) => V(a3, r4, P())))
  } : { success: true, data: t3.value };
};
var P4 = f3(g3);
var l4 = (e) => async (n3, c6, s4) => {
  const r4 = s4 ? Object.assign(s4, { async: true }) : { async: true };
  let t3 = n3._zod.run({ value: c6, issues: [] }, r4);
  return t3 instanceof Promise && (t3 = await t3), t3.issues.length ? {
    success: false,
    error: new e(t3.issues.map((a3) => V(a3, r4, P())))
  } : { success: true, data: t3.value };
};
var j3 = l4(g3);
var E5 = (e) => (n3, c6, s4) => {
  const r4 = s4 ? Object.assign(s4, { direction: "backward" }) : { direction: "backward" };
  return g4(e)(n3, c6, r4);
};
var O3 = (e) => (n3, c6, s4) => g4(e)(n3, c6, s4);
var _4 = (e) => async (n3, c6, s4) => {
  const r4 = s4 ? Object.assign(s4, { direction: "backward" }) : { direction: "backward" };
  return m4(e)(n3, c6, r4);
};
var z3 = (e) => async (n3, c6, s4) => m4(e)(n3, c6, s4);
var v4 = (e) => (n3, c6, s4) => {
  const r4 = s4 ? Object.assign(s4, { direction: "backward" }) : { direction: "backward" };
  return f3(e)(n3, c6, r4);
};
var Z3 = (e) => (n3, c6, s4) => f3(e)(n3, c6, s4);
var $3 = (e) => async (n3, c6, s4) => {
  const r4 = s4 ? Object.assign(s4, { direction: "backward" }) : { direction: "backward" };
  return l4(e)(n3, c6, r4);
};
var D2 = (e) => async (n3, c6, s4) => l4(e)(n3, c6, s4);

// node_modules/vibegame/dist/node_modules/zod/v4/core/versions.js
var o2 = {
  major: 4,
  minor: 1,
  patch: 12
};

// node_modules/vibegame/dist/node_modules/zod/v4/core/schemas.js
var _5 = l("$ZodType", (n3, e) => {
  var _a;
  var t3;
  n3 ?? (n3 = {}), n3._zod.def = e, n3._zod.bag = n3._zod.bag || {}, n3._zod.version = o2;
  const o3 = [...n3._zod.def.checks ?? []];
  n3._zod.traits.has("$ZodCheck") && o3.unshift(n3);
  for (const r4 of o3)
    for (const s4 of r4._zod.onattach)
      s4(n3);
  if (o3.length === 0)
    (t3 = n3._zod).deferred ?? (t3.deferred = []), (_a = n3._zod.deferred) == null ? void 0 : _a.push(() => {
      n3._zod.run = n3._zod.parse;
    });
  else {
    const r4 = (u5, a3, l6) => {
      let c6 = $(u5), p7;
      for (const f6 of a3) {
        if (f6._zod.def.when) {
          if (!f6._zod.def.when(u5))
            continue;
        } else if (c6)
          continue;
        const h5 = u5.issues.length, z6 = f6._zod.check(u5);
        if (z6 instanceof Promise && (l6 == null ? void 0 : l6.async) === false)
          throw new p();
        if (p7 || z6 instanceof Promise)
          p7 = (p7 ?? Promise.resolve()).then(async () => {
            await z6, u5.issues.length !== h5 && (c6 || (c6 = $(u5, h5)));
          });
        else {
          if (u5.issues.length === h5)
            continue;
          c6 || (c6 = $(u5, h5));
        }
      }
      return p7 ? p7.then(() => u5) : u5;
    }, s4 = (u5, a3, l6) => {
      if ($(u5))
        return u5.aborted = true, u5;
      const c6 = r4(a3, o3, l6);
      if (c6 instanceof Promise) {
        if (l6.async === false)
          throw new p();
        return c6.then((p7) => n3._zod.parse(p7, l6));
      }
      return n3._zod.parse(c6, l6);
    };
    n3._zod.run = (u5, a3) => {
      if (a3.skipChecks)
        return n3._zod.parse(u5, a3);
      if (a3.direction === "backward") {
        const c6 = n3._zod.parse({ value: u5.value, issues: [] }, { ...a3, skipChecks: true });
        return c6 instanceof Promise ? c6.then((p7) => s4(p7, u5, a3)) : s4(c6, u5, a3);
      }
      const l6 = n3._zod.parse(u5, a3);
      if (l6 instanceof Promise) {
        if (a3.async === false)
          throw new p();
        return l6.then((c6) => r4(c6, o3, a3));
      }
      return r4(l6, o3, a3);
    };
  }
  n3["~standard"] = {
    validate: (r4) => {
      var _a2;
      try {
        const s4 = P4(n3, r4);
        return s4.success ? { value: s4.data } : { issues: (_a2 = s4.error) == null ? void 0 : _a2.issues };
      } catch {
        return j3(n3, r4).then((u5) => {
          var _a3;
          return u5.success ? { value: u5.data } : { issues: (_a3 = u5.error) == null ? void 0 : _a3.issues };
        });
      }
    },
    vendor: "zod",
    version: 1
  };
});
var Ce = l("$ZodString", (n3, e) => {
  var _a;
  _5.init(n3, e), n3._zod.pattern = [...((_a = n3 == null ? void 0 : n3._zod.bag) == null ? void 0 : _a.patterns) ?? []].pop() ?? v2(n3._zod.bag), n3._zod.parse = (t3, o3) => {
    if (e.coerce)
      try {
        t3.value = String(t3.value);
      } catch {
      }
    return typeof t3.value == "string" || t3.issues.push({
      expected: "string",
      code: "invalid_type",
      input: t3.value,
      inst: n3
    }), t3;
  };
});
var d4 = l("$ZodStringFormat", (n3, e) => {
  g2.init(n3, e), Ce.init(n3, e);
});
var ye = l("$ZodGUID", (n3, e) => {
  e.pattern ?? (e.pattern = r), d4.init(n3, e);
});
var He = l("$ZodUUID", (n3, e) => {
  if (e.version) {
    const o3 = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    }[e.version];
    if (o3 === void 0)
      throw new Error(`Invalid UUID version: "${e.version}"`);
    e.pattern ?? (e.pattern = p2(o3));
  } else
    e.pattern ?? (e.pattern = p2());
  d4.init(n3, e);
});
var qe = l("$ZodEmail", (n3, e) => {
  e.pattern ?? (e.pattern = m2), d4.init(n3, e);
});
var Qe = l("$ZodURL", (n3, e) => {
  d4.init(n3, e), n3._zod.check = (t3) => {
    try {
      const o3 = t3.value.trim(), r4 = new URL(o3);
      e.hostname && (e.hostname.lastIndex = 0, e.hostname.test(r4.hostname) || t3.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid hostname",
        pattern: h2.source,
        input: t3.value,
        inst: n3,
        continue: !e.abort
      })), e.protocol && (e.protocol.lastIndex = 0, e.protocol.test(r4.protocol.endsWith(":") ? r4.protocol.slice(0, -1) : r4.protocol) || t3.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid protocol",
        pattern: e.protocol.source,
        input: t3.value,
        inst: n3,
        continue: !e.abort
      })), e.normalize ? t3.value = r4.href : t3.value = o3;
      return;
    } catch {
      t3.issues.push({
        code: "invalid_format",
        format: "url",
        input: t3.value,
        inst: n3,
        continue: !e.abort
      });
    }
  };
});
var Ye = l("$ZodEmoji", (n3, e) => {
  e.pattern ?? (e.pattern = z2()), d4.init(n3, e);
});
var xe = l("$ZodNanoID", (n3, e) => {
  e.pattern ?? (e.pattern = F2), d4.init(n3, e);
});
var en = l("$ZodCUID", (n3, e) => {
  e.pattern ?? (e.pattern = c2), d4.init(n3, e);
});
var nn = l("$ZodCUID2", (n3, e) => {
  e.pattern ?? (e.pattern = d2), d4.init(n3, e);
});
var tn = l("$ZodULID", (n3, e) => {
  e.pattern ?? (e.pattern = i), d4.init(n3, e);
});
var rn = l("$ZodXID", (n3, e) => {
  e.pattern ?? (e.pattern = s), d4.init(n3, e);
});
var on = l("$ZodKSUID", (n3, e) => {
  e.pattern ?? (e.pattern = $2), d4.init(n3, e);
});
var sn = l("$ZodISODateTime", (n3, e) => {
  e.pattern ?? (e.pattern = j2(e)), d4.init(n3, e);
});
var un = l("$ZodISODate", (n3, e) => {
  e.pattern ?? (e.pattern = R2), d4.init(n3, e);
});
var an = l("$ZodISOTime", (n3, e) => {
  e.pattern ?? (e.pattern = _2(e)), d4.init(n3, e);
});
var cn = l("$ZodISODuration", (n3, e) => {
  e.pattern ?? (e.pattern = u2), d4.init(n3, e);
});
var ln = l("$ZodIPv4", (n3, e) => {
  e.pattern ?? (e.pattern = Z), d4.init(n3, e), n3._zod.onattach.push((t3) => {
    const o3 = t3._zod.bag;
    o3.format = "ipv4";
  });
});
var pn = l("$ZodIPv6", (n3, e) => {
  e.pattern ?? (e.pattern = x2), d4.init(n3, e), n3._zod.onattach.push((t3) => {
    const o3 = t3._zod.bag;
    o3.format = "ipv6";
  }), n3._zod.check = (t3) => {
    try {
      new URL(`http://[${t3.value}]`);
    } catch {
      t3.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: t3.value,
        inst: n3,
        continue: !e.abort
      });
    }
  };
});
var vn = l("$ZodCIDRv4", (n3, e) => {
  e.pattern ?? (e.pattern = g), d4.init(n3, e);
});
var dn = l("$ZodCIDRv6", (n3, e) => {
  e.pattern ?? (e.pattern = l3), d4.init(n3, e), n3._zod.check = (t3) => {
    const o3 = t3.value.split("/");
    try {
      if (o3.length !== 2)
        throw new Error();
      const [r4, s4] = o3;
      if (!s4)
        throw new Error();
      const u5 = Number(s4);
      if (`${u5}` !== s4)
        throw new Error();
      if (u5 < 0 || u5 > 128)
        throw new Error();
      new URL(`http://[${r4}]`);
    } catch {
      t3.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: t3.value,
        inst: n3,
        continue: !e.abort
      });
    }
  };
});
function y3(n3) {
  if (n3 === "")
    return true;
  if (n3.length % 4 !== 0)
    return false;
  try {
    return atob(n3), true;
  } catch {
    return false;
  }
}
var hn = l("$ZodBase64", (n3, e) => {
  e.pattern ?? (e.pattern = E2), d4.init(n3, e), n3._zod.onattach.push((t3) => {
    t3._zod.bag.contentEncoding = "base64";
  }), n3._zod.check = (t3) => {
    y3(t3.value) || t3.issues.push({
      code: "invalid_format",
      format: "base64",
      input: t3.value,
      inst: n3,
      continue: !e.abort
    });
  };
});
function Le(n3) {
  if (!b2.test(n3))
    return false;
  const e = n3.replace(/[-_]/g, (o3) => o3 === "-" ? "+" : "/"), t3 = e.padEnd(Math.ceil(e.length / 4) * 4, "=");
  return y3(t3);
}
var _n = l("$ZodBase64URL", (n3, e) => {
  e.pattern ?? (e.pattern = b2), d4.init(n3, e), n3._zod.onattach.push((t3) => {
    t3._zod.bag.contentEncoding = "base64url";
  }), n3._zod.check = (t3) => {
    Le(t3.value) || t3.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: t3.value,
      inst: n3,
      continue: !e.abort
    });
  };
});
var zn = l("$ZodE164", (n3, e) => {
  e.pattern ?? (e.pattern = w2), d4.init(n3, e);
});
function Ve(n3, e = null) {
  try {
    const t3 = n3.split(".");
    if (t3.length !== 3)
      return false;
    const [o3] = t3;
    if (!o3)
      return false;
    const r4 = JSON.parse(atob(o3));
    return !("typ" in r4 && (r4 == null ? void 0 : r4.typ) !== "JWT" || !r4.alg || e && (!("alg" in r4) || r4.alg !== e));
  } catch {
    return false;
  }
}
var fn = l("$ZodJWT", (n3, e) => {
  d4.init(n3, e), n3._zod.check = (t3) => {
    Ve(t3.value, e.alg) || t3.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: t3.value,
      inst: n3,
      continue: !e.abort
    });
  };
});
var Ae = l("$ZodNumber", (n3, e) => {
  _5.init(n3, e), n3._zod.pattern = n3._zod.bag.pattern ?? T2, n3._zod.parse = (t3, o3) => {
    if (e.coerce)
      try {
        t3.value = Number(t3.value);
      } catch {
      }
    const r4 = t3.value;
    if (typeof r4 == "number" && !Number.isNaN(r4) && Number.isFinite(r4))
      return t3;
    const s4 = typeof r4 == "number" ? Number.isNaN(r4) ? "NaN" : Number.isFinite(r4) ? void 0 : "Infinity" : void 0;
    return t3.issues.push({
      expected: "number",
      code: "invalid_type",
      input: r4,
      inst: n3,
      ...s4 ? { received: s4 } : {}
    }), t3;
  };
});
var mn = l("$ZodNumber", (n3, e) => {
  w3.init(n3, e), Ae.init(n3, e);
});
var $n = l("$ZodBoolean", (n3, e) => {
  _5.init(n3, e), n3._zod.pattern = M2, n3._zod.parse = (t3, o3) => {
    if (e.coerce)
      try {
        t3.value = !!t3.value;
      } catch {
      }
    const r4 = t3.value;
    return typeof r4 == "boolean" || t3.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: r4,
      inst: n3
    }), t3;
  };
});
var Zn = l("$ZodUnknown", (n3, e) => {
  _5.init(n3, e), n3._zod.parse = (t3) => t3;
});
var gn = l("$ZodNever", (n3, e) => {
  _5.init(n3, e), n3._zod.parse = (t3, o3) => (t3.issues.push({
    expected: "never",
    code: "invalid_type",
    input: t3.value,
    inst: n3
  }), t3);
});
function C2(n3, e, t3) {
  n3.issues.length && e.issues.push(...L(t3, n3.issues)), e.value[t3] = n3.value;
}
var bn = l("$ZodArray", (n3, e) => {
  _5.init(n3, e), n3._zod.parse = (t3, o3) => {
    const r4 = t3.value;
    if (!Array.isArray(r4))
      return t3.issues.push({
        expected: "array",
        code: "invalid_type",
        input: r4,
        inst: n3
      }), t3;
    t3.value = Array(r4.length);
    const s4 = [];
    for (let u5 = 0; u5 < r4.length; u5++) {
      const a3 = r4[u5], l6 = e.element._zod.run({
        value: a3,
        issues: []
      }, o3);
      l6 instanceof Promise ? s4.push(l6.then((c6) => C2(c6, t3, u5))) : C2(l6, t3, u5);
    }
    return s4.length ? Promise.all(s4).then(() => t3) : t3;
  };
});
function P5(n3, e, t3, o3) {
  n3.issues.length && e.issues.push(...L(t3, n3.issues)), n3.value === void 0 ? t3 in o3 && (e.value[t3] = void 0) : e.value[t3] = n3.value;
}
function H(n3) {
  var _a, _b, _c2, _d;
  const e = Object.keys(n3.shape);
  for (const o3 of e)
    if (!((_d = (_c2 = (_b = (_a = n3.shape) == null ? void 0 : _a[o3]) == null ? void 0 : _b._zod) == null ? void 0 : _c2.traits) == null ? void 0 : _d.has("$ZodType")))
      throw new Error(`Invalid element at key "${o3}": expected a Zod schema`);
  const t3 = N(n3.shape);
  return {
    ...n3,
    keys: e,
    keySet: new Set(e),
    numKeys: e.length,
    optionalKeys: new Set(t3)
  };
}
function q(n3, e, t3, o3, r4, s4) {
  const u5 = [], a3 = r4.keySet, l6 = r4.catchall._zod, c6 = l6.def.type;
  for (const p7 of Object.keys(e)) {
    if (a3.has(p7))
      continue;
    if (c6 === "never") {
      u5.push(p7);
      continue;
    }
    const f6 = l6.run({ value: e[p7], issues: [] }, o3);
    f6 instanceof Promise ? n3.push(f6.then((h5) => P5(h5, t3, p7, e))) : P5(f6, t3, p7, e);
  }
  return u5.length && t3.issues.push({
    code: "unrecognized_keys",
    keys: u5,
    input: e,
    inst: s4
  }), n3.length ? Promise.all(n3).then(() => t3) : t3;
}
var Be = l("$ZodObject", (n3, e) => {
  var _a;
  if (_5.init(n3, e), !((_a = Object.getOwnPropertyDescriptor(e, "shape")) == null ? void 0 : _a.get)) {
    const a3 = e.shape;
    Object.defineProperty(e, "shape", {
      get: () => {
        const l6 = { ...a3 };
        return Object.defineProperty(e, "shape", {
          value: l6
        }), l6;
      }
    });
  }
  const o3 = y2(() => H(e));
  O(n3._zod, "propValues", () => {
    const a3 = e.shape, l6 = {};
    for (const c6 in a3) {
      const p7 = a3[c6]._zod;
      if (p7.values) {
        l6[c6] ?? (l6[c6] = /* @__PURE__ */ new Set());
        for (const f6 of p7.values)
          l6[c6].add(f6);
      }
    }
    return l6;
  });
  const r4 = h, s4 = e.catchall;
  let u5;
  n3._zod.parse = (a3, l6) => {
    u5 ?? (u5 = o3.value);
    const c6 = a3.value;
    if (!r4(c6))
      return a3.issues.push({
        expected: "object",
        code: "invalid_type",
        input: c6,
        inst: n3
      }), a3;
    a3.value = {};
    const p7 = [], f6 = u5.shape;
    for (const h5 of u5.keys) {
      const m8 = f6[h5]._zod.run({ value: c6[h5], issues: [] }, l6);
      m8 instanceof Promise ? p7.push(m8.then((I6) => P5(I6, a3, h5, c6))) : P5(m8, a3, h5, c6);
    }
    return s4 ? q(p7, c6, a3, l6, o3.value, n3) : p7.length ? Promise.all(p7).then(() => a3) : a3;
  };
});
var wn = l("$ZodObjectJIT", (n3, e) => {
  Be.init(n3, e);
  const t3 = n3._zod.parse, o3 = y2(() => H(e)), r4 = (h5) => {
    const z6 = new h3(["shape", "payload", "ctx"]), m8 = o3.value, I6 = (Z5) => {
      const $7 = k(Z5);
      return `shape[${$7}]._zod.run({ value: input[${$7}], issues: [] }, ctx)`;
    };
    z6.write("const input = payload.value;");
    const D7 = /* @__PURE__ */ Object.create(null);
    let Q2 = 0;
    for (const Z5 of m8.keys)
      D7[Z5] = `key_${Q2++}`;
    z6.write("const newResult = {};");
    for (const Z5 of m8.keys) {
      const $7 = D7[Z5], b5 = k(Z5);
      z6.write(`const ${$7} = ${I6(Z5)};`), z6.write(`
        if (${$7}.issues.length) {
          payload.issues = payload.issues.concat(${$7}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${b5}, ...iss.path] : [${b5}]
          })));
        }
        
        
        if (${$7}.value === undefined) {
          if (${b5} in input) {
            newResult[${b5}] = undefined;
          }
        } else {
          newResult[${b5}] = ${$7}.value;
        }
        
      `);
    }
    z6.write("payload.value = newResult;"), z6.write("return payload;");
    const Y2 = z6.compile();
    return (Z5, $7) => Y2(h5, Z5, $7);
  };
  let s4;
  const u5 = h, a3 = !f.jitless, c6 = a3 && A.value, p7 = e.catchall;
  let f6;
  n3._zod.parse = (h5, z6) => {
    f6 ?? (f6 = o3.value);
    const m8 = h5.value;
    return u5(m8) ? a3 && c6 && (z6 == null ? void 0 : z6.async) === false && z6.jitless !== true ? (s4 || (s4 = r4(e.shape)), h5 = s4(h5, z6), p7 ? q([], m8, h5, z6, f6, n3) : h5) : t3(h5, z6) : (h5.issues.push({
      expected: "object",
      code: "invalid_type",
      input: m8,
      inst: n3
    }), h5);
  };
});
function L3(n3, e, t3, o3) {
  for (const s4 of n3)
    if (s4.issues.length === 0)
      return e.value = s4.value, e;
  const r4 = n3.filter((s4) => !$(s4));
  return r4.length === 1 ? (e.value = r4[0].value, r4[0]) : (e.issues.push({
    code: "invalid_union",
    input: e.value,
    inst: t3,
    errors: n3.map((s4) => s4.issues.map((u5) => V(u5, o3, P())))
  }), e);
}
var kn = l("$ZodUnion", (n3, e) => {
  _5.init(n3, e), O(n3._zod, "optin", () => e.options.some((r4) => r4._zod.optin === "optional") ? "optional" : void 0), O(n3._zod, "optout", () => e.options.some((r4) => r4._zod.optout === "optional") ? "optional" : void 0), O(n3._zod, "values", () => {
    if (e.options.every((r4) => r4._zod.values))
      return new Set(e.options.flatMap((r4) => Array.from(r4._zod.values)));
  }), O(n3._zod, "pattern", () => {
    if (e.options.every((r4) => r4._zod.pattern)) {
      const r4 = e.options.map((s4) => s4._zod.pattern);
      return new RegExp(`^(${r4.map((s4) => z(s4.source)).join("|")})$`);
    }
  });
  const t3 = e.options.length === 1, o3 = e.options[0]._zod.run;
  n3._zod.parse = (r4, s4) => {
    if (t3)
      return o3(r4, s4);
    let u5 = false;
    const a3 = [];
    for (const l6 of e.options) {
      const c6 = l6._zod.run({
        value: r4.value,
        issues: []
      }, s4);
      if (c6 instanceof Promise)
        a3.push(c6), u5 = true;
      else {
        if (c6.issues.length === 0)
          return c6;
        a3.push(c6);
      }
    }
    return u5 ? Promise.all(a3).then((l6) => L3(l6, r4, n3, s4)) : L3(a3, r4, n3, s4);
  };
});
var Pn = l("$ZodIntersection", (n3, e) => {
  _5.init(n3, e), n3._zod.parse = (t3, o3) => {
    const r4 = t3.value, s4 = e.left._zod.run({ value: r4, issues: [] }, o3), u5 = e.right._zod.run({ value: r4, issues: [] }, o3);
    return s4 instanceof Promise || u5 instanceof Promise ? Promise.all([s4, u5]).then(([l6, c6]) => V2(t3, l6, c6)) : V2(t3, s4, u5);
  };
});
function O4(n3, e) {
  if (n3 === e)
    return { valid: true, data: n3 };
  if (n3 instanceof Date && e instanceof Date && +n3 == +e)
    return { valid: true, data: n3 };
  if (d(n3) && d(e)) {
    const t3 = Object.keys(e), o3 = Object.keys(n3).filter((s4) => t3.indexOf(s4) !== -1), r4 = { ...n3, ...e };
    for (const s4 of o3) {
      const u5 = O4(n3[s4], e[s4]);
      if (!u5.valid)
        return {
          valid: false,
          mergeErrorPath: [s4, ...u5.mergeErrorPath]
        };
      r4[s4] = u5.data;
    }
    return { valid: true, data: r4 };
  }
  if (Array.isArray(n3) && Array.isArray(e)) {
    if (n3.length !== e.length)
      return { valid: false, mergeErrorPath: [] };
    const t3 = [];
    for (let o3 = 0; o3 < n3.length; o3++) {
      const r4 = n3[o3], s4 = e[o3], u5 = O4(r4, s4);
      if (!u5.valid)
        return {
          valid: false,
          mergeErrorPath: [o3, ...u5.mergeErrorPath]
        };
      t3.push(u5.data);
    }
    return { valid: true, data: t3 };
  }
  return { valid: false, mergeErrorPath: [] };
}
function V2(n3, e, t3) {
  if (e.issues.length && n3.issues.push(...e.issues), t3.issues.length && n3.issues.push(...t3.issues), $(n3))
    return n3;
  const o3 = O4(e.value, t3.value);
  if (!o3.valid)
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(o3.mergeErrorPath)}`);
  return n3.value = o3.data, n3;
}
var In = l("$ZodEnum", (n3, e) => {
  _5.init(n3, e);
  const t3 = _(e.entries), o3 = new Set(t3);
  n3._zod.values = o3, n3._zod.pattern = new RegExp(`^(${t3.filter((r4) => m.has(typeof r4)).map((r4) => typeof r4 == "string" ? v(r4) : r4.toString()).join("|")})$`), n3._zod.parse = (r4, s4) => {
    const u5 = r4.value;
    return o3.has(u5) || r4.issues.push({
      code: "invalid_value",
      values: t3,
      input: u5,
      inst: n3
    }), r4;
  };
});
var Tn = l("$ZodLiteral", (n3, e) => {
  if (_5.init(n3, e), e.values.length === 0)
    throw new Error("Cannot create literal schema with no valid values");
  n3._zod.values = new Set(e.values), n3._zod.pattern = new RegExp(`^(${e.values.map((t3) => typeof t3 == "string" ? v(t3) : t3 ? v(t3.toString()) : String(t3)).join("|")})$`), n3._zod.parse = (t3, o3) => {
    const r4 = t3.value;
    return n3._zod.values.has(r4) || t3.issues.push({
      code: "invalid_value",
      values: e.values,
      input: r4,
      inst: n3
    }), t3;
  };
});
var Rn = l("$ZodTransform", (n3, e) => {
  _5.init(n3, e), n3._zod.parse = (t3, o3) => {
    if (o3.direction === "backward")
      throw new y(n3.constructor.name);
    const r4 = e.transform(t3.value, t3);
    if (o3.async)
      return (r4 instanceof Promise ? r4 : Promise.resolve(r4)).then((u5) => (t3.value = u5, t3));
    if (r4 instanceof Promise)
      throw new p();
    return t3.value = r4, t3;
  };
});
function A4(n3, e) {
  return n3.issues.length && e === void 0 ? { issues: [], value: void 0 } : n3;
}
var En = l("$ZodOptional", (n3, e) => {
  _5.init(n3, e), n3._zod.optin = "optional", n3._zod.optout = "optional", O(n3._zod, "values", () => e.innerType._zod.values ? /* @__PURE__ */ new Set([...e.innerType._zod.values, void 0]) : void 0), O(n3._zod, "pattern", () => {
    const t3 = e.innerType._zod.pattern;
    return t3 ? new RegExp(`^(${z(t3.source)})?$`) : void 0;
  }), n3._zod.parse = (t3, o3) => {
    if (e.innerType._zod.optin === "optional") {
      const r4 = e.innerType._zod.run(t3, o3);
      return r4 instanceof Promise ? r4.then((s4) => A4(s4, t3.value)) : A4(r4, t3.value);
    }
    return t3.value === void 0 ? t3 : e.innerType._zod.run(t3, o3);
  };
});
var On = l("$ZodNullable", (n3, e) => {
  _5.init(n3, e), O(n3._zod, "optin", () => e.innerType._zod.optin), O(n3._zod, "optout", () => e.innerType._zod.optout), O(n3._zod, "pattern", () => {
    const t3 = e.innerType._zod.pattern;
    return t3 ? new RegExp(`^(${z(t3.source)}|null)$`) : void 0;
  }), O(n3._zod, "values", () => e.innerType._zod.values ? /* @__PURE__ */ new Set([...e.innerType._zod.values, null]) : void 0), n3._zod.parse = (t3, o3) => t3.value === null ? t3 : e.innerType._zod.run(t3, o3);
});
var Sn = l("$ZodDefault", (n3, e) => {
  _5.init(n3, e), n3._zod.optin = "optional", O(n3._zod, "values", () => e.innerType._zod.values), n3._zod.parse = (t3, o3) => {
    if (o3.direction === "backward")
      return e.innerType._zod.run(t3, o3);
    if (t3.value === void 0)
      return t3.value = e.defaultValue, t3;
    const r4 = e.innerType._zod.run(t3, o3);
    return r4 instanceof Promise ? r4.then((s4) => B(s4, e)) : B(r4, e);
  };
});
function B(n3, e) {
  return n3.value === void 0 && (n3.value = e.defaultValue), n3;
}
var Dn = l("$ZodPrefault", (n3, e) => {
  _5.init(n3, e), n3._zod.optin = "optional", O(n3._zod, "values", () => e.innerType._zod.values), n3._zod.parse = (t3, o3) => (o3.direction === "backward" || t3.value === void 0 && (t3.value = e.defaultValue), e.innerType._zod.run(t3, o3));
});
var jn = l("$ZodNonOptional", (n3, e) => {
  _5.init(n3, e), O(n3._zod, "values", () => {
    const t3 = e.innerType._zod.values;
    return t3 ? new Set([...t3].filter((o3) => o3 !== void 0)) : void 0;
  }), n3._zod.parse = (t3, o3) => {
    const r4 = e.innerType._zod.run(t3, o3);
    return r4 instanceof Promise ? r4.then((s4) => F4(s4, n3)) : F4(r4, n3);
  };
});
function F4(n3, e) {
  return !n3.issues.length && n3.value === void 0 && n3.issues.push({
    code: "invalid_type",
    expected: "nonoptional",
    input: n3.value,
    inst: e
  }), n3;
}
var Un = l("$ZodCatch", (n3, e) => {
  _5.init(n3, e), O(n3._zod, "optin", () => e.innerType._zod.optin), O(n3._zod, "optout", () => e.innerType._zod.optout), O(n3._zod, "values", () => e.innerType._zod.values), n3._zod.parse = (t3, o3) => {
    if (o3.direction === "backward")
      return e.innerType._zod.run(t3, o3);
    const r4 = e.innerType._zod.run(t3, o3);
    return r4 instanceof Promise ? r4.then((s4) => (t3.value = s4.value, s4.issues.length && (t3.value = e.catchValue({
      ...t3,
      error: {
        issues: s4.issues.map((u5) => V(u5, o3, P()))
      },
      input: t3.value
    }), t3.issues = []), t3)) : (t3.value = r4.value, r4.issues.length && (t3.value = e.catchValue({
      ...t3,
      error: {
        issues: r4.issues.map((s4) => V(s4, o3, P()))
      },
      input: t3.value
    }), t3.issues = []), t3);
  };
});
var Nn = l("$ZodPipe", (n3, e) => {
  _5.init(n3, e), O(n3._zod, "values", () => e.in._zod.values), O(n3._zod, "optin", () => e.in._zod.optin), O(n3._zod, "optout", () => e.out._zod.optout), O(n3._zod, "propValues", () => e.in._zod.propValues), n3._zod.parse = (t3, o3) => {
    if (o3.direction === "backward") {
      const s4 = e.out._zod.run(t3, o3);
      return s4 instanceof Promise ? s4.then((u5) => w4(u5, e.in, o3)) : w4(s4, e.in, o3);
    }
    const r4 = e.in._zod.run(t3, o3);
    return r4 instanceof Promise ? r4.then((s4) => w4(s4, e.out, o3)) : w4(r4, e.out, o3);
  };
});
function w4(n3, e, t3) {
  return n3.issues.length ? (n3.aborted = true, n3) : e._zod.run({ value: n3.value, issues: n3.issues }, t3);
}
var Cn = l("$ZodReadonly", (n3, e) => {
  _5.init(n3, e), O(n3._zod, "propValues", () => e.innerType._zod.propValues), O(n3._zod, "values", () => e.innerType._zod.values), O(n3._zod, "optin", () => e.innerType._zod.optin), O(n3._zod, "optout", () => e.innerType._zod.optout), n3._zod.parse = (t3, o3) => {
    if (o3.direction === "backward")
      return e.innerType._zod.run(t3, o3);
    const r4 = e.innerType._zod.run(t3, o3);
    return r4 instanceof Promise ? r4.then(J) : J(r4);
  };
});
function J(n3) {
  return n3.value = Object.freeze(n3.value), n3;
}
var Ln = l("$ZodCustom", (n3, e) => {
  s2.init(n3, e), _5.init(n3, e), n3._zod.parse = (t3, o3) => t3, n3._zod.check = (t3) => {
    const o3 = t3.value, r4 = e.fn(o3);
    if (r4 instanceof Promise)
      return r4.then((s4) => K(s4, t3, o3, n3));
    K(r4, t3, o3, n3);
  };
});
function K(n3, e, t3, o3) {
  if (!n3) {
    const r4 = {
      code: "custom",
      input: t3,
      inst: o3,
      // incorporates params.error into issue reporting
      path: [...o3._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !o3._zod.def.abort
      // params: inst._zod.def.params,
    };
    o3._zod.def.params && (r4.params = o3._zod.def.params), e.issues.push(G(r4));
  }
}

// node_modules/vibegame/dist/node_modules/zod/v4/core/registries.js
var r2 = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(t3, ...i3) {
    const e = i3[0];
    if (this._map.set(t3, e), e && typeof e == "object" && "id" in e) {
      if (this._idmap.has(e.id))
        throw new Error(`ID ${e.id} already exists in the registry`);
      this._idmap.set(e.id, t3);
    }
    return this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(t3) {
    const i3 = this._map.get(t3);
    return i3 && typeof i3 == "object" && "id" in i3 && this._idmap.delete(i3.id), this._map.delete(t3), this;
  }
  get(t3) {
    const i3 = t3._zod.parent;
    if (i3) {
      const e = { ...this.get(i3) ?? {} };
      delete e.id;
      const s4 = { ...e, ...this._map.get(t3) };
      return Object.keys(s4).length ? s4 : void 0;
    }
    return this._map.get(t3);
  }
  has(t3) {
    return this._map.has(t3);
  }
};
function n() {
  return new r2();
}
var p3 = n();

// node_modules/vibegame/dist/node_modules/zod/v4/core/api.js
function $4(t3, e) {
  return new t3({
    type: "string",
    ...I(e)
  });
}
function x3(t3, e) {
  return new t3({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function L4(t3, e) {
  return new t3({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function z4(t3, e) {
  return new t3({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function j4(t3, e) {
  return new t3({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...I(e)
  });
}
function T4(t3, e) {
  return new t3({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...I(e)
  });
}
function W(t3, e) {
  return new t3({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...I(e)
  });
}
function D3(t3, e) {
  return new t3({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function M4(t3, e) {
  return new t3({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function O5(t3, e) {
  return new t3({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function U2(t3, e) {
  return new t3({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function q2(t3, e) {
  return new t3({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function E6(t3, e) {
  return new t3({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function I3(t3, e) {
  return new t3({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function R4(t3, e) {
  return new t3({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function G2(t3, e) {
  return new t3({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function P6(t3, e) {
  return new t3({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function S4(t3, e) {
  return new t3({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function A5(t3, e) {
  return new t3({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function B2(t3, e) {
  return new t3({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function F5(t3, e) {
  return new t3({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function H2(t3, e) {
  return new t3({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function J2(t3, e) {
  return new t3({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...I(e)
  });
}
function K2(t3, e) {
  return new t3({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...I(e)
  });
}
function N3(t3, e) {
  return new t3({
    type: "string",
    format: "date",
    check: "string_format",
    ...I(e)
  });
}
function Q(t3, e) {
  return new t3({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...I(e)
  });
}
function V3(t3, e) {
  return new t3({
    type: "string",
    format: "duration",
    check: "string_format",
    ...I(e)
  });
}
function X(t3, e) {
  return new t3({
    type: "number",
    checks: [],
    ...I(e)
  });
}
function Y(t3, e) {
  return new t3({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...I(e)
  });
}
function tt(t3, e) {
  return new t3({
    type: "boolean",
    ...I(e)
  });
}
function et(t3) {
  return new t3({
    type: "unknown"
  });
}
function nt(t3, e) {
  return new t3({
    type: "never",
    ...I(e)
  });
}
function rt(t3, e) {
  return new Z2({
    check: "less_than",
    ...I(e),
    value: t3,
    inclusive: false
  });
}
function it(t3, e) {
  return new Z2({
    check: "less_than",
    ...I(e),
    value: t3,
    inclusive: true
  });
}
function ot(t3, e) {
  return new I2({
    check: "greater_than",
    ...I(e),
    value: t3,
    inclusive: false
  });
}
function ct(t3, e) {
  return new I2({
    check: "greater_than",
    ...I(e),
    value: t3,
    inclusive: true
  });
}
function ut(t3, e) {
  return new N2({
    check: "multiple_of",
    ...I(e),
    value: t3
  });
}
function at(t3, e) {
  return new E3({
    check: "max_length",
    ...I(e),
    maximum: t3
  });
}
function st(t3, e) {
  return new M3({
    check: "min_length",
    ...I(e),
    minimum: t3
  });
}
function ft(t3, e) {
  return new S3({
    check: "length_equals",
    ...I(e),
    length: t3
  });
}
function _t(t3, e) {
  return new T3({
    check: "string_format",
    format: "regex",
    ...I(e),
    pattern: t3
  });
}
function mt(t3) {
  return new R3({
    check: "string_format",
    format: "lowercase",
    ...I(t3)
  });
}
function ht(t3) {
  return new d3({
    check: "string_format",
    format: "uppercase",
    ...I(t3)
  });
}
function gt(t3, e) {
  return new F3({
    check: "string_format",
    format: "includes",
    ...I(e),
    includes: t3
  });
}
function lt(t3, e) {
  return new L2({
    check: "string_format",
    format: "starts_with",
    ...I(e),
    prefix: t3
  });
}
function kt(t3, e) {
  return new O2({
    check: "string_format",
    format: "ends_with",
    ...I(e),
    suffix: t3
  });
}
function c3(t3) {
  return new A3({
    check: "overwrite",
    tx: t3
  });
}
function wt(t3) {
  return c3((e) => e.normalize(t3));
}
function pt() {
  return c3((t3) => t3.trim());
}
function dt() {
  return c3((t3) => t3.toLowerCase());
}
function bt() {
  return c3((t3) => t3.toUpperCase());
}
function yt(t3, e, r4) {
  return new t3({
    type: "array",
    element: e,
    // get element() {
    //   return element;
    // },
    ...I(r4)
  });
}
function vt(t3, e, r4) {
  return new t3({
    type: "custom",
    check: "custom",
    fn: e,
    ...I(r4)
  });
}
function Ct(t3) {
  const e = v5((r4) => (r4.addIssue = (o3) => {
    if (typeof o3 == "string")
      r4.issues.push(G(o3, r4.value, e._zod.def));
    else {
      const i3 = o3;
      i3.fatal && (i3.continue = false), i3.code ?? (i3.code = "custom"), i3.input ?? (i3.input = r4.value), i3.inst ?? (i3.inst = e), i3.continue ?? (i3.continue = !e._zod.def.abort), r4.issues.push(G(i3));
    }
  }, t3(r4.value, r4)));
  return e;
}
function v5(t3, e) {
  const r4 = new s2({
    check: "custom",
    ...I(e)
  });
  return r4._zod.check = t3, r4;
}

// node_modules/vibegame/dist/node_modules/zod/v4/classic/iso.js
var D4 = l("ZodISODateTime", (o3, t3) => {
  sn.init(o3, t3), d5.init(o3, t3);
});
function f4(o3) {
  return K2(D4, o3);
}
var I4 = l("ZodISODate", (o3, t3) => {
  un.init(o3, t3), d5.init(o3, t3);
});
function _6(o3) {
  return N3(I4, o3);
}
var O6 = l("ZodISOTime", (o3, t3) => {
  an.init(o3, t3), d5.init(o3, t3);
});
function g5(o3) {
  return Q(O6, o3);
}
var c4 = l("ZodISODuration", (o3, t3) => {
  cn.init(o3, t3), d5.init(o3, t3);
});
function x4(o3) {
  return V3(c4, o3);
}

// node_modules/vibegame/dist/node_modules/zod/v4/classic/errors.js
var m5 = (r4, s4) => {
  m3.init(r4, s4), r4.name = "ZodError", Object.defineProperties(r4, {
    format: {
      value: (e) => _3(r4, e)
      // enumerable: false,
    },
    flatten: {
      value: (e) => E4(r4, e)
      // enumerable: false,
    },
    addIssue: {
      value: (e) => {
        r4.issues.push(e), r4.message = JSON.stringify(r4.issues, b, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (e) => {
        r4.issues.push(...e), r4.message = JSON.stringify(r4.issues, b, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return r4.issues.length === 0;
      }
      // enumerable: false,
    }
  });
};
var p4 = l("ZodError", m5, {
  Parent: Error
});

// node_modules/vibegame/dist/node_modules/zod/v4/classic/parse.js
var m6 = g4(p4);
var D5 = m4(p4);
var P7 = f3(p4);
var i2 = l4(p4);
var l5 = E5(p4);
var x5 = O3(p4);
var R5 = _4(p4);
var Z4 = z3(p4);
var b3 = v4(p4);
var g6 = Z3(p4);
var h4 = $3(p4);
var j5 = D2(p4);

// node_modules/vibegame/dist/node_modules/zod/v4/classic/schemas.js
var u4 = l("ZodType", (e, o3) => (_5.init(e, o3), e.def = o3, e.type = o3.type, Object.defineProperty(e, "_def", { value: o3 }), e.check = (...c6) => e.clone(f2(o3, {
  checks: [
    ...o3.checks ?? [],
    ...c6.map((r4) => typeof r4 == "function" ? { _zod: { check: r4, def: { check: "custom" }, onattach: [] } } : r4)
  ]
})), e.clone = (c6, r4) => u(e, c6, r4), e.brand = () => e, e.register = (c6, r4) => (c6.add(e, r4), e), e.parse = (c6, r4) => m6(e, c6, r4, { callee: e.parse }), e.safeParse = (c6, r4) => P7(e, c6, r4), e.parseAsync = async (c6, r4) => D5(e, c6, r4, { callee: e.parseAsync }), e.safeParseAsync = async (c6, r4) => i2(e, c6, r4), e.spa = e.safeParseAsync, e.encode = (c6, r4) => l5(e, c6, r4), e.decode = (c6, r4) => x5(e, c6, r4), e.encodeAsync = async (c6, r4) => R5(e, c6, r4), e.decodeAsync = async (c6, r4) => Z4(e, c6, r4), e.safeEncode = (c6, r4) => b3(e, c6, r4), e.safeDecode = (c6, r4) => g6(e, c6, r4), e.safeEncodeAsync = async (c6, r4) => h4(e, c6, r4), e.safeDecodeAsync = async (c6, r4) => j5(e, c6, r4), e.refine = (c6, r4) => e.check(Cc(c6, r4)), e.superRefine = (c6) => e.check(xc(c6)), e.overwrite = (c6) => e.check(c3(c6)), e.optional = () => D6(e), e.nullable = () => U3(e), e.nullish = () => D6(U3(e)), e.nonoptional = (c6) => $c(e, c6), e.array = () => tc(e), e.or = (c6) => pc([e, c6]), e.and = (c6) => hc(e, c6), e.transform = (c6) => N4(e, fc(c6)), e.default = (c6) => wc(e, c6), e.prefault = (c6) => bc(e, c6), e.catch = (c6) => Uc(e, c6), e.pipe = (c6) => N4(e, c6), e.readonly = () => Ec(e), e.describe = (c6) => {
  const r4 = e.clone();
  return p3.add(r4, { description: c6 }), r4;
}, Object.defineProperty(e, "description", {
  get() {
    var _a;
    return (_a = p3.get(e)) == null ? void 0 : _a.description;
  },
  configurable: true
}), e.meta = (...c6) => {
  if (c6.length === 0)
    return p3.get(e);
  const r4 = e.clone();
  return p3.add(r4, c6[0]), r4;
}, e.isOptional = () => e.safeParse(void 0).success, e.isNullable = () => e.safeParse(null).success, e));
var x6 = l("_ZodString", (e, o3) => {
  Ce.init(e, o3), u4.init(e, o3);
  const c6 = e._zod.bag;
  e.format = c6.format ?? null, e.minLength = c6.minimum ?? null, e.maxLength = c6.maximum ?? null, e.regex = (...r4) => e.check(_t(...r4)), e.includes = (...r4) => e.check(gt(...r4)), e.startsWith = (...r4) => e.check(lt(...r4)), e.endsWith = (...r4) => e.check(kt(...r4)), e.min = (...r4) => e.check(st(...r4)), e.max = (...r4) => e.check(at(...r4)), e.length = (...r4) => e.check(ft(...r4)), e.nonempty = (...r4) => e.check(st(1, ...r4)), e.lowercase = (r4) => e.check(mt(r4)), e.uppercase = (r4) => e.check(ht(r4)), e.trim = () => e.check(pt()), e.normalize = (...r4) => e.check(wt(...r4)), e.toLowerCase = () => e.check(dt()), e.toUpperCase = () => e.check(bt());
});
var So = l("ZodString", (e, o3) => {
  Ce.init(e, o3), x6.init(e, o3), e.email = (c6) => e.check(x3(Fo, c6)), e.url = (c6) => e.check(D3(Bo, c6)), e.jwt = (c6) => e.check(J2(cc, c6)), e.emoji = (c6) => e.check(M4(Wo, c6)), e.guid = (c6) => e.check(L4(g7, c6)), e.uuid = (c6) => e.check(z4(p5, c6)), e.uuidv4 = (c6) => e.check(j4(p5, c6)), e.uuidv6 = (c6) => e.check(T4(p5, c6)), e.uuidv7 = (c6) => e.check(W(p5, c6)), e.nanoid = (c6) => e.check(O5(Go, c6)), e.guid = (c6) => e.check(L4(g7, c6)), e.cuid = (c6) => e.check(U2(Ko, c6)), e.cuid2 = (c6) => e.check(q2(Jo, c6)), e.ulid = (c6) => e.check(E6(Mo, c6)), e.base64 = (c6) => e.check(B2(so, c6)), e.base64url = (c6) => e.check(F5(ec, c6)), e.xid = (c6) => e.check(I3(Yo, c6)), e.ksuid = (c6) => e.check(R4(Vo, c6)), e.ipv4 = (c6) => e.check(G2(Xo, c6)), e.ipv6 = (c6) => e.check(P6(qo, c6)), e.cidrv4 = (c6) => e.check(S4(Ho, c6)), e.cidrv6 = (c6) => e.check(A5(Qo, c6)), e.e164 = (c6) => e.check(H2(oc, c6)), e.datetime = (c6) => e.check(f4(c6)), e.date = (c6) => e.check(_6(c6)), e.time = (c6) => e.check(g5(c6)), e.duration = (c6) => e.check(x4(c6));
});
function Fc(e) {
  return $4(So, e);
}
var d5 = l("ZodStringFormat", (e, o3) => {
  d4.init(e, o3), x6.init(e, o3);
});
var Fo = l("ZodEmail", (e, o3) => {
  qe.init(e, o3), d5.init(e, o3);
});
var g7 = l("ZodGUID", (e, o3) => {
  ye.init(e, o3), d5.init(e, o3);
});
var p5 = l("ZodUUID", (e, o3) => {
  He.init(e, o3), d5.init(e, o3);
});
var Bo = l("ZodURL", (e, o3) => {
  Qe.init(e, o3), d5.init(e, o3);
});
var Wo = l("ZodEmoji", (e, o3) => {
  Ye.init(e, o3), d5.init(e, o3);
});
var Go = l("ZodNanoID", (e, o3) => {
  xe.init(e, o3), d5.init(e, o3);
});
var Ko = l("ZodCUID", (e, o3) => {
  en.init(e, o3), d5.init(e, o3);
});
var Jo = l("ZodCUID2", (e, o3) => {
  nn.init(e, o3), d5.init(e, o3);
});
var Mo = l("ZodULID", (e, o3) => {
  tn.init(e, o3), d5.init(e, o3);
});
var Yo = l("ZodXID", (e, o3) => {
  rn.init(e, o3), d5.init(e, o3);
});
var Vo = l("ZodKSUID", (e, o3) => {
  on.init(e, o3), d5.init(e, o3);
});
var Xo = l("ZodIPv4", (e, o3) => {
  ln.init(e, o3), d5.init(e, o3);
});
var qo = l("ZodIPv6", (e, o3) => {
  pn.init(e, o3), d5.init(e, o3);
});
var Ho = l("ZodCIDRv4", (e, o3) => {
  vn.init(e, o3), d5.init(e, o3);
});
var Qo = l("ZodCIDRv6", (e, o3) => {
  dn.init(e, o3), d5.init(e, o3);
});
var so = l("ZodBase64", (e, o3) => {
  hn.init(e, o3), d5.init(e, o3);
});
var ec = l("ZodBase64URL", (e, o3) => {
  _n.init(e, o3), d5.init(e, o3);
});
var oc = l("ZodE164", (e, o3) => {
  zn.init(e, o3), d5.init(e, o3);
});
var cc = l("ZodJWT", (e, o3) => {
  fn.init(e, o3), d5.init(e, o3);
});
var A6 = l("ZodNumber", (e, o3) => {
  Ae.init(e, o3), u4.init(e, o3), e.gt = (r4, a3) => e.check(ot(r4, a3)), e.gte = (r4, a3) => e.check(ct(r4, a3)), e.min = (r4, a3) => e.check(ct(r4, a3)), e.lt = (r4, a3) => e.check(rt(r4, a3)), e.lte = (r4, a3) => e.check(it(r4, a3)), e.max = (r4, a3) => e.check(it(r4, a3)), e.int = (r4) => e.check(b4(r4)), e.safe = (r4) => e.check(b4(r4)), e.positive = (r4) => e.check(ot(0, r4)), e.nonnegative = (r4) => e.check(ct(0, r4)), e.negative = (r4) => e.check(rt(0, r4)), e.nonpositive = (r4) => e.check(it(0, r4)), e.multipleOf = (r4, a3) => e.check(ut(r4, a3)), e.step = (r4, a3) => e.check(ut(r4, a3)), e.finite = () => e;
  const c6 = e._zod.bag;
  e.minValue = Math.max(c6.minimum ?? Number.NEGATIVE_INFINITY, c6.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, e.maxValue = Math.min(c6.maximum ?? Number.POSITIVE_INFINITY, c6.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, e.isInt = (c6.format ?? "").includes("int") || Number.isSafeInteger(c6.multipleOf ?? 0.5), e.isFinite = true, e.format = c6.format ?? null;
});
function Bc(e) {
  return X(A6, e);
}
var rc = l("ZodNumberFormat", (e, o3) => {
  mn.init(e, o3), A6.init(e, o3);
});
function b4(e) {
  return Y(rc, e);
}
var nc = l("ZodBoolean", (e, o3) => {
  $n.init(e, o3), u4.init(e, o3);
});
function Wc(e) {
  return tt(nc, e);
}
var ac = l("ZodUnknown", (e, o3) => {
  Zn.init(e, o3), u4.init(e, o3);
});
function $5() {
  return et(ac);
}
var uc = l("ZodNever", (e, o3) => {
  gn.init(e, o3), u4.init(e, o3);
});
function dc(e) {
  return nt(uc, e);
}
var lc = l("ZodArray", (e, o3) => {
  bn.init(e, o3), u4.init(e, o3), e.element = o3.element, e.min = (c6, r4) => e.check(st(c6, r4)), e.nonempty = (c6) => e.check(st(1, c6)), e.max = (c6, r4) => e.check(at(c6, r4)), e.length = (c6, r4) => e.check(ft(c6, r4)), e.unwrap = () => e.element;
});
function tc(e, o3) {
  return yt(lc, e, o3);
}
var mc = l("ZodObject", (e, o3) => {
  wn.init(e, o3), u4.init(e, o3), O(e, "shape", () => o3.shape), e.keyof = () => kc(Object.keys(e._zod.def.shape)), e.catchall = (c6) => e.clone({ ...e._zod.def, catchall: c6 }), e.passthrough = () => e.clone({ ...e._zod.def, catchall: $5() }), e.loose = () => e.clone({ ...e._zod.def, catchall: $5() }), e.strict = () => e.clone({ ...e._zod.def, catchall: dc() }), e.strip = () => e.clone({ ...e._zod.def, catchall: void 0 }), e.extend = (c6) => R(e, c6), e.safeExtend = (c6) => U(e, c6), e.merge = (c6) => D(e, c6), e.pick = (c6) => T(e, c6), e.omit = (c6) => P2(e, c6), e.partial = (...c6) => F(O7, e, c6[0]), e.required = (...c6) => M(z5, e, c6[0]);
});
function Gc(e, o3) {
  const c6 = {
    type: "object",
    shape: e ?? {},
    ...I(o3)
  };
  return new mc(c6);
}
var Zc = l("ZodUnion", (e, o3) => {
  kn.init(e, o3), u4.init(e, o3), e.options = o3.options;
});
function pc(e, o3) {
  return new Zc({
    type: "union",
    options: e,
    ...I(o3)
  });
}
var ic = l("ZodIntersection", (e, o3) => {
  Pn.init(e, o3), u4.init(e, o3);
});
function hc(e, o3) {
  return new ic({
    type: "intersection",
    left: e,
    right: o3
  });
}
var _7 = l("ZodEnum", (e, o3) => {
  In.init(e, o3), u4.init(e, o3), e.enum = o3.entries, e.options = Object.values(o3.entries);
  const c6 = new Set(Object.keys(o3.entries));
  e.extract = (r4, a3) => {
    const t3 = {};
    for (const l6 of r4)
      if (c6.has(l6))
        t3[l6] = o3.entries[l6];
      else
        throw new Error(`Key ${l6} not found in enum`);
    return new _7({
      ...o3,
      checks: [],
      ...I(a3),
      entries: t3
    });
  }, e.exclude = (r4, a3) => {
    const t3 = { ...o3.entries };
    for (const l6 of r4)
      if (c6.has(l6))
        delete t3[l6];
      else
        throw new Error(`Key ${l6} not found in enum`);
    return new _7({
      ...o3,
      checks: [],
      ...I(a3),
      entries: t3
    });
  };
});
function kc(e, o3) {
  const c6 = Array.isArray(e) ? Object.fromEntries(e.map((r4) => [r4, r4])) : e;
  return new _7({
    type: "enum",
    entries: c6,
    ...I(o3)
  });
}
var _c = l("ZodLiteral", (e, o3) => {
  Tn.init(e, o3), u4.init(e, o3), e.values = new Set(o3.values), Object.defineProperty(e, "value", {
    get() {
      if (o3.values.length > 1)
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      return o3.values[0];
    }
  });
});
function Kc(e, o3) {
  return new _c({
    type: "literal",
    values: Array.isArray(e) ? e : [e],
    ...I(o3)
  });
}
var yc = l("ZodTransform", (e, o3) => {
  Rn.init(e, o3), u4.init(e, o3), e._zod.parse = (c6, r4) => {
    if (r4.direction === "backward")
      throw new y(e.constructor.name);
    c6.addIssue = (t3) => {
      if (typeof t3 == "string")
        c6.issues.push(G(t3, c6.value, o3));
      else {
        const l6 = t3;
        l6.fatal && (l6.continue = false), l6.code ?? (l6.code = "custom"), l6.input ?? (l6.input = c6.value), l6.inst ?? (l6.inst = e), c6.issues.push(G(l6));
      }
    };
    const a3 = o3.transform(c6.value, c6);
    return a3 instanceof Promise ? a3.then((t3) => (c6.value = t3, c6)) : (c6.value = a3, c6);
  };
});
function fc(e) {
  return new yc({
    type: "transform",
    transform: e
  });
}
var O7 = l("ZodOptional", (e, o3) => {
  En.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType;
});
function D6(e) {
  return new O7({
    type: "optional",
    innerType: e
  });
}
var Ic = l("ZodNullable", (e, o3) => {
  On.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType;
});
function U3(e) {
  return new Ic({
    type: "nullable",
    innerType: e
  });
}
var vc = l("ZodDefault", (e, o3) => {
  Sn.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function wc(e, o3) {
  return new vc({
    type: "default",
    innerType: e,
    get defaultValue() {
      return typeof o3 == "function" ? o3() : j(o3);
    }
  });
}
var gc = l("ZodPrefault", (e, o3) => {
  Dn.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType;
});
function bc(e, o3) {
  return new gc({
    type: "prefault",
    innerType: e,
    get defaultValue() {
      return typeof o3 == "function" ? o3() : j(o3);
    }
  });
}
var z5 = l("ZodNonOptional", (e, o3) => {
  jn.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType;
});
function $c(e, o3) {
  return new z5({
    type: "nonoptional",
    innerType: e,
    ...I(o3)
  });
}
var Dc = l("ZodCatch", (e, o3) => {
  Un.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function Uc(e, o3) {
  return new Dc({
    type: "catch",
    innerType: e,
    catchValue: typeof o3 == "function" ? o3 : () => o3
  });
}
var Nc = l("ZodPipe", (e, o3) => {
  Nn.init(e, o3), u4.init(e, o3), e.in = o3.in, e.out = o3.out;
});
function N4(e, o3) {
  return new Nc({
    type: "pipe",
    in: e,
    out: o3
    // ...util.normalizeParams(params),
  });
}
var Tc = l("ZodReadonly", (e, o3) => {
  Cn.init(e, o3), u4.init(e, o3), e.unwrap = () => e._zod.def.innerType;
});
function Ec(e) {
  return new Tc({
    type: "readonly",
    innerType: e
  });
}
var Pc = l("ZodCustom", (e, o3) => {
  Ln.init(e, o3), u4.init(e, o3);
});
function Cc(e, o3 = {}) {
  return vt(Pc, e, o3);
}
function xc(e) {
  return Ct(e);
}

// node_modules/vibegame/dist/core/validation/schemas.js
var t2 = Bc();
var p6 = Fc().regex(/^-?\d+(\.\d+)?$/).transform((i3) => parseFloat(i3));
var c5 = pc([
  Wc(),
  Kc("true").transform(() => true),
  Kc("false").transform(() => false),
  Kc(1).transform(() => true),
  Kc(0).transform(() => false)
]);
var n2 = pc([
  Gc({
    x: Bc(),
    y: Bc(),
    z: Bc()
  }),
  t2.transform((i3) => ({ x: i3, y: i3, z: i3 })),
  p6.transform((i3) => ({ x: i3, y: i3, z: i3 })),
  Fc().regex(/^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?\s+-?\d+(\.\d+)?$/).transform((i3) => {
    const [b5, g8, z6] = i3.split(/\s+/).map(Number);
    return { x: b5, y: g8, z: z6 };
  })
]);
pc([
  Gc({
    x: Bc(),
    y: Bc()
  }),
  t2.transform((i3) => ({ x: i3, y: i3 })),
  p6.transform((i3) => ({ x: i3, y: i3 })),
  Fc().regex(/^-?\d+(\.\d+)?\s+-?\d+(\.\d+)?$/).transform((i3) => {
    const [b5, g8] = i3.split(/\s+/).map(Number);
    return { x: b5, y: g8 };
  })
]);
var r3 = pc([
  Fc().regex(/^#[0-9a-fA-F]{6}$/).transform((i3) => parseInt(i3.slice(1), 16)),
  Fc().regex(/^0x[0-9a-fA-F]{6}$/).transform((i3) => parseInt(i3.slice(2), 16)),
  t2,
  p6
]);
var s3 = kc(["box", "sphere"]);
var k3 = kc(["static", "dynamic", "kinematic"]);
var m7 = Gc({
  pos: n2.optional(),
  scale: n2.optional(),
  euler: n2.optional(),
  rot: dc().optional()
}).strict();
var f5 = Gc({
  type: k3.optional(),
  pos: n2.optional(),
  euler: n2.optional(),
  mass: t2.optional(),
  "linear-damping": t2.optional(),
  "angular-damping": t2.optional(),
  "gravity-scale": t2.optional()
}).strict();
var d6 = Gc({
  shape: s3.optional(),
  size: n2.optional(),
  restitution: t2.optional(),
  friction: t2.optional(),
  density: t2.optional(),
  sensor: c5.optional()
}).strict();
var y4 = Gc({
  shape: s3.optional(),
  size: n2.optional(),
  color: r3.optional(),
  "cast-shadow": c5.optional(),
  "receive-shadow": c5.optional(),
  visible: c5.optional()
}).strict();
var S5 = Gc({
  distance: t2.optional(),
  "min-distance": t2.optional(),
  "max-distance": t2.optional(),
  "min-pitch": t2.optional(),
  "max-pitch": t2.optional(),
  "target-pitch": t2.optional(),
  "target-yaw": t2.optional(),
  sensitivity: t2.optional(),
  smoothing: t2.optional(),
  enabled: c5.optional()
}).strict();
var x7 = Gc({
  speed: t2.optional(),
  "jump-height": t2.optional(),
  acceleration: t2.optional(),
  "air-control": t2.optional(),
  enabled: c5.optional()
}).strict();
var C3 = Gc({
  transform: pc([Fc(), m7]).optional(),
  body: pc([Fc(), f5]).optional(),
  collider: pc([Fc(), d6]).optional(),
  renderer: pc([Fc(), y4]).optional(),
  "orbit-camera": pc([Fc(), S5]).optional(),
  player: pc([Fc(), x7]).optional(),
  pos: n2.optional(),
  scale: n2.optional(),
  euler: n2.optional(),
  color: r3.optional(),
  size: n2.optional(),
  shape: s3.optional(),
  id: Fc().optional()
}).passthrough();
var R6 = Gc({
  pos: n2,
  shape: s3,
  size: n2,
  color: r3,
  transform: pc([Fc(), m7]).optional(),
  collider: pc([Fc(), d6]).optional(),
  renderer: pc([Fc(), y4]).optional(),
  scale: n2.optional(),
  euler: n2.optional(),
  restitution: t2.optional(),
  friction: t2.optional(),
  id: Fc().optional(),
  name: Fc().optional()
}).strict();
var $6 = Gc({
  pos: n2,
  shape: s3,
  size: n2,
  color: r3,
  transform: pc([Fc(), m7]).optional(),
  body: pc([Fc(), f5]).optional(),
  collider: pc([Fc(), d6]).optional(),
  renderer: pc([Fc(), y4]).optional(),
  scale: n2.optional(),
  euler: n2.optional(),
  mass: t2.optional(),
  restitution: t2.optional(),
  friction: t2.optional(),
  id: Fc().optional(),
  name: Fc().optional()
}).strict();
var j6 = Gc({
  pos: n2,
  shape: s3,
  size: n2,
  color: r3,
  transform: pc([Fc(), m7]).optional(),
  body: pc([Fc(), f5]).optional(),
  collider: pc([Fc(), d6]).optional(),
  renderer: pc([Fc(), y4]).optional(),
  scale: n2.optional(),
  euler: n2.optional(),
  id: Fc().optional(),
  name: Fc().optional()
}).strict();
var E7 = Gc({
  pos: n2.optional(),
  speed: t2.optional(),
  "jump-height": t2.optional(),
  acceleration: t2.optional(),
  "air-control": t2.optional(),
  transform: pc([Fc(), m7]).optional(),
  body: pc([Fc(), f5]).optional(),
  collider: pc([Fc(), d6]).optional(),
  player: pc([Fc(), x7]).optional(),
  id: Fc().optional()
}).strict();
var F6 = Gc({
  distance: t2.optional(),
  "min-distance": t2.optional(),
  "max-distance": t2.optional(),
  "target-pitch": t2.optional(),
  "target-yaw": t2.optional(),
  transform: pc([Fc(), m7]).optional(),
  "orbit-camera": pc([Fc(), S5]).optional(),
  id: Fc().optional()
}).strict();
var P8 = Gc({
  canvas: Fc().optional(),
  sky: r3.optional(),
  fog: r3.optional(),
  "fog-near": t2.optional(),
  "fog-far": t2.optional(),
  gravity: n2.optional(),
  id: Fc().optional()
}).strict();
var v6 = kc([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "sine-in",
  "sine-out",
  "sine-in-out",
  "quad-in",
  "quad-out",
  "quad-in-out",
  "cubic-in",
  "cubic-out",
  "cubic-in-out",
  "quart-in",
  "quart-out",
  "quart-in-out",
  "expo-in",
  "expo-out",
  "expo-in-out",
  "circ-in",
  "circ-out",
  "circ-in-out",
  "back-in",
  "back-out",
  "back-in-out",
  "elastic-in",
  "elastic-out",
  "elastic-in-out",
  "bounce-in",
  "bounce-out",
  "bounce-in-out"
]);
kc(["once", "loop", "ping-pong"]);
var A7 = Gc({
  target: Fc(),
  attr: Fc(),
  from: pc([t2, p6, n2]).optional(),
  to: pc([t2, p6, n2]),
  duration: pc([t2, p6]).default(1),
  delay: pc([t2, p6]).optional(),
  easing: v6.optional(),
  id: Fc().optional(),
  name: Fc().optional()
}).strict();
var I5 = Gc({
  duration: pc([t2, p6]).default(0)
}).strict();
var N5 = Gc({
  id: Fc().optional(),
  name: Fc().optional()
}).strict();
var _8 = {
  entity: C3,
  "static-part": R6,
  "dynamic-part": $6,
  "kinematic-part": j6,
  player: E7,
  camera: F6,
  world: P8,
  tween: A7,
  pause: I5,
  sequence: N5
};

export {
  addEntity,
  removeEntity,
  entityExists,
  defineQuery,
  defineComponent,
  hasComponent,
  addComponent,
  removeComponent,
  createWorld,
  Types,
  o,
  _8 as _
};
//# sourceMappingURL=chunk-4ERPUZ7I.js.map
