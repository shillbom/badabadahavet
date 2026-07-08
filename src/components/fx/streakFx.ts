import type { Container, Graphics, Ticker } from "pixi.js";
import type { PixiFx } from "./PixiLayer";

/**
 * Streak-card tier effects, drawn as flat 2D vector shapes (see PixiLayer).
 * Geometry is built once per mount; the ticker only mutates transforms.
 *
 * Randomness is fine here (unlike React render code) — it runs once inside
 * the builder, so every mount just gets its own particle arrangement.
 */

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/* ---------------------------------- 🫧 ---------------------------------- */

/** Rising soap bubbles: thin white ring, faint fill, off-centre highlight. */
export const bubblesFx: PixiFx = (PIXI, app) => {
  const ctx = new PIXI.GraphicsContext()
    .circle(0, 0, 6)
    .fill({ color: 0xffffff, alpha: 0.16 })
    .stroke({ width: 1.4, color: 0xffffff, alpha: 0.85 })
    .arc(-1.5, -1.5, 3.4, Math.PI * 0.95, Math.PI * 1.45)
    .stroke({ width: 1.2, color: 0xffffff, alpha: 0.9, cap: "round" });

  const bubbles = Array.from({ length: 8 }, () => {
    const g = new PIXI.Graphics(ctx);
    g.scale.set(rand(0.5, 1.3));
    g.x = rand(0, app.screen.width);
    g.y = app.screen.height + rand(0, app.screen.height);
    app.stage.addChild(g);
    return {
      g,
      speed: rand(0.25, 0.6),
      sway: rand(0.15, 0.4),
      phase: rand(0, Math.PI * 2),
    };
  });

  let t = 0;
  const tick = (ticker: Ticker) => {
    t += ticker.deltaMS / 1000;
    for (const b of bubbles) {
      b.g.y -= b.speed * ticker.deltaTime;
      b.g.x += Math.sin(t * 2.2 + b.phase) * b.sway * ticker.deltaTime;
      if (b.g.y < -10) {
        b.g.y = app.screen.height + 10;
        b.g.x = rand(0, app.screen.width);
      }
    }
  };
  app.ticker.add(tick);
  return () => app.ticker.remove(tick);
};

/* ---------------------------------- 🔥 ---------------------------------- */

/** Cartoon flame: a smooth teardrop — round belly resting on the x-axis,
 *  tip reaching (0,-12). Drawn ~12px tall; instances scale from there. */
function flameShape(g: Graphics): Graphics {
  return g
    .moveTo(0, -12)
    .bezierCurveTo(3.5, -8, 5.5, -6.5, 5.5, -3.5)
    .bezierCurveTo(5.5, -1, 3, 0, 0, 0)
    .bezierCurveTo(-3, 0, -5.5, -1, -5.5, -3.5)
    .bezierCurveTo(-5.5, -6.5, -3.5, -8, 0, -12)
    .closePath();
}

type Flame = {
  node: Container;
  base: number;
  phase: number;
  speed: number;
};

/** One flame = three nested teardrops (deep red → orange → yellow core). */
function makeFlame(PIXI: typeof import("pixi.js"), scale: number): Flame {
  const node = new PIXI.Container();
  const outer = flameShape(new PIXI.Graphics()).fill(0xdc2626);
  const mid = flameShape(new PIXI.Graphics()).fill(0xf97316);
  mid.scale.set(0.72, 0.66);
  const core = flameShape(new PIXI.Graphics()).fill(0xfde047);
  core.scale.set(0.42, 0.36);
  core.x = 0.5;
  node.addChild(outer, mid, core);
  node.scale.set(scale);
  return { node, base: scale, phase: rand(0, Math.PI * 2), speed: rand(5, 8) };
}

function tickFlames(flames: Flame[], t: number) {
  for (const f of flames) {
    const lick =
      Math.sin(t * f.speed + f.phase) * 0.16 +
      Math.sin(t * f.speed * 2.7 + f.phase * 2) * 0.07;
    f.node.scale.set(f.base * (1 - lick * 0.5), f.base * (1 + lick));
    f.node.rotation = Math.sin(t * f.speed * 0.6 + f.phase) * 0.07;
  }
}

/** Inside the fire card: glowing sparks always; at 10+ a burning flame row
 *  along the bottom edge; 20+ turns it into a proper inferno. */
export const fireFx: PixiFx = (PIXI, app, { level }) => {
  const lvl = Number(level);
  const W = app.screen.width;
  const H = app.screen.height;

  const flames: Flame[] = [];
  if (lvl >= 2) {
    const count = lvl >= 3 ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const f = makeFlame(PIXI, rand(1.1, lvl >= 3 ? 2.6 : 1.7));
      // Even spread with jitter; bases tucked just below the card edge.
      f.node.x = ((i + 0.5) / count) * W + rand(-6, 6);
      f.node.y = H + 3;
      app.stage.addChild(f.node);
      flames.push(f);
    }
  }

  // Sparks pop against the gradient with additive blending.
  const sparkCtx = new PIXI.GraphicsContext().circle(0, 0, 1.8).fill(0xfde047);
  const sparks = Array.from(
    { length: lvl >= 3 ? 14 : lvl === 2 ? 10 : 6 },
    () => {
      const g = new PIXI.Graphics(sparkCtx);
      g.blendMode = "add";
      g.scale.set(rand(0.6, 1.4));
      g.x = rand(0, W);
      g.y = rand(0, H);
      app.stage.addChild(g);
      return { g, speed: rand(0.5, 1.1), phase: rand(0, Math.PI * 2) };
    },
  );

  let t = 0;
  const tick = (ticker: Ticker) => {
    t += ticker.deltaMS / 1000;
    tickFlames(flames, t);
    for (const s of sparks) {
      s.g.y -= s.speed * ticker.deltaTime;
      s.g.x += Math.sin(t * 3 + s.phase) * 0.2 * ticker.deltaTime;
      s.g.alpha = 0.4 + Math.sin(t * 6 + s.phase) * 0.35;
      if (s.g.y < -4) {
        s.g.y = H + 4;
        s.g.x = rand(0, W);
      }
    }
  };
  app.ticker.add(tick);
  return () => app.ticker.remove(tick);
};

/** The strip above the card (10+): flames whose bases hide behind the card
 *  and lick out past its top edge. The canvas overlaps the card slightly so
 *  the card, painted later in the DOM, masks the roots. */
export const edgeFireFx: PixiFx = (PIXI, app, { level }) => {
  const lvl = Number(level);
  const count = lvl >= 3 ? 8 : 4;
  const flames: Flame[] = [];
  for (let i = 0; i < count; i++) {
    const f = makeFlame(PIXI, rand(0.9, lvl >= 3 ? 2.1 : 1.4));
    f.node.x = ((i + 0.5) / count) * app.screen.width + rand(-8, 8);
    f.node.y = app.screen.height;
    app.stage.addChild(f.node);
    flames.push(f);
  }
  let t = 0;
  const tick = (ticker: Ticker) => {
    t += ticker.deltaMS / 1000;
    tickFlames(flames, t);
  };
  app.ticker.add(tick);
  return () => app.ticker.remove(tick);
};

/* ---------------------------------- 🪩 ---------------------------------- */

const BEAM_COLORS = [0xffffff, 0x9ef3ff, 0xffb3f2, 0xfff2a1, 0xb7ffd0];

/** Club light rig: additive wedge beams sweeping from the centre plus
 *  twinkling four-point sparkles. 40+ doubles the rig and speeds it up. */
export const discoFx: PixiFx = (PIXI, app, { level }) => {
  const lvl = Number(level);
  const cx = app.screen.width / 2;
  const cy = app.screen.height / 2;
  const reach = Math.hypot(cx, cy) + 20;

  const rig = new PIXI.Container();
  rig.x = cx;
  rig.y = cy;
  const beamCount = lvl >= 2 ? 6 : 3;
  for (let i = 0; i < beamCount; i++) {
    const angle = (i / beamCount) * Math.PI * 2;
    const half = 0.055; // beam half-width in radians
    const beam = new PIXI.Graphics()
      .poly([
        0,
        0,
        Math.cos(angle - half) * reach,
        Math.sin(angle - half) * reach,
        Math.cos(angle + half) * reach,
        Math.sin(angle + half) * reach,
      ])
      .fill({ color: BEAM_COLORS[i % BEAM_COLORS.length], alpha: 0.35 });
    beam.blendMode = "add";
    rig.addChild(beam);
  }
  app.stage.addChild(rig);

  const sparkleCtx = new PIXI.GraphicsContext()
    .star(0, 0, 4, 5, 1.8)
    .fill(0xffffff);
  const sparkles = Array.from({ length: lvl >= 2 ? 7 : 4 }, () => {
    const g = new PIXI.Graphics(sparkleCtx);
    g.blendMode = "add";
    g.x = rand(4, app.screen.width - 4);
    g.y = rand(4, app.screen.height - 4);
    app.stage.addChild(g);
    return { g, phase: rand(0, Math.PI * 2), speed: rand(2.5, 4.5) };
  });

  const spin = lvl >= 2 ? 0.9 : 0.5; // radians / second
  let t = 0;
  const tick = (ticker: Ticker) => {
    t += ticker.deltaMS / 1000;
    rig.rotation += spin * (ticker.deltaMS / 1000);
    for (const s of sparkles) {
      const pulse = (Math.sin(t * s.speed + s.phase) + 1) / 2;
      s.g.alpha = 0.25 + pulse * 0.75;
      s.g.scale.set(0.6 + pulse * 0.7);
      s.g.rotation = t * 0.8 + s.phase;
    }
  };
  app.ticker.add(tick);
  return () => app.ticker.remove(tick);
};
