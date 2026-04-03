// node_modules/vibegame/dist/core/utils/naming.js
function o(e) {
  return e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").replace(/_/g, "-").replace(/([A-Z]+)/g, (a) => a.toLowerCase()).replace(/--+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
function p(e) {
  return e.replace(/-([a-z])/g, (a, r) => r.toUpperCase());
}

// node_modules/vibegame/dist/core/recipes/diagnostics.js
function c(e, o2) {
  const t = [];
  for (let n = 0; n <= o2.length; n++)
    t[n] = [n];
  for (let n = 0; n <= e.length; n++)
    t[0][n] = n;
  for (let n = 1; n <= o2.length; n++)
    for (let r = 1; r <= e.length; r++)
      o2.charAt(n - 1) === e.charAt(r - 1) ? t[n][r] = t[n - 1][r - 1] : t[n][r] = Math.min(
        t[n - 1][r - 1] + 1,
        // substitution
        t[n][r - 1] + 1,
        // insertion
        t[n - 1][r] + 1
        // deletion
      );
  return t[o2.length][e.length];
}
function f(e, o2, t = 3) {
  let n = null, r = t + 1;
  for (const i of o2) {
    const s = c(
      e.toLowerCase(),
      i.toLowerCase()
    );
    s < r && (r = s, n = i);
  }
  return r <= t ? n : null;
}
function u(e, o2 = 5) {
  if (e.length === 0) return "none";
  if (e.length <= o2)
    return e.join(", ");
  const t = e.slice(0, o2), n = e.length - o2;
  return `${t.join(", ")} (+${n} more)`;
}
function $(e, o2) {
  const t = f(e, o2);
  let n = `Unknown element <${e}>`;
  return t && (n += ` - did you mean <${t}>?`), o2.length > 0 && (n += `
  Available recipes: ${u(o2)}`), n;
}
function g(e, o2, t, n) {
  const r = f(e, t);
  let i = `[${o2}] Unknown attribute "${e}"`;
  return r && (i += ` - did you mean "${r}"?`), n && n.length > 0 && (i += `
  Shorthands: ${u(n)}`), t.length > 0 && (i += `
  Available: ${u(t)}`), e.includes("-") && !r && (i += `
  Note: Custom components must be registered before creating the Game instance`), i;
}
function l(e, o2, t, n) {
  const r = n ? f(o2, n) : null;
  let i = `[${e}.${o2}] ${t}`;
  return r && (i += ` - did you mean "${r}"?`), n && n.length > 0 && (i += `
  Available: ${u(n)}`), i;
}
function m(e, o2, t, n) {
  return `[${e}] Syntax error in "${o2}" - ${n}
  Expected: ${t}`;
}
function h(e, o2, t, n) {
  const r = f(t, n);
  let i = `[${e}.${o2}] Invalid value "${t}"`;
  return r && (i += ` - did you mean "${r}"?`), i += `
  Valid options: ${u(n)}`, i;
}
function d(e, o2, t, n) {
  return `[${e}.${o2}] Type mismatch - expected ${t}, got ${n}`;
}
function y(e, o2, t, n) {
  return `[${e}.${o2}] Wrong number of values - expected ${t}, got ${n}`;
}
function E(e) {
  const o2 = [];
  for (const t in e) {
    if (typeof e[t] == "function" || t.startsWith("_")) continue;
    const n = t.replace(/([A-Z])/g, "-$1").toLowerCase();
    o2.push(n);
  }
  return o2;
}

export {
  o,
  p,
  $,
  g,
  l,
  m,
  h,
  d,
  y,
  E
};
//# sourceMappingURL=chunk-P23F7SKT.js.map
