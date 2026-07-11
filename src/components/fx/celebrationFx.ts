import type { GraphicsContext, Ticker } from "pixi.js";
import type { PixiFx } from "./PixiLayer";

/**
 * One-shot confetti burst for the celebration overlay (points, achievements,
 * streak tiers). Custom flat 2D shapes per splash kind — droplets, bubbles,
 * sparkles, snowflakes, flames, stars, confetti — shot out of the centre
 * with friction, gravity and spin, drawn once and animated on the ticker.
 */

const rand = (min: number, max: number) => min + Math.random() * (max - min);

type ShapeName =
  | "droplet"
  | "bubble"
  | "sparkle"
  | "snowflake"
  | "flame"
  | "star"
  | "confetti"
  | "note";

/** Which shapes fly for which splash, hero shape first (spawned ~2:1). */
const VARIANT_SHAPES: Record<string, ShapeName[]> = {
  swim: ["droplet", "bubble"],
  newspot: ["sparkle", "droplet"],
  winter: ["snowflake", "droplet"],
  achievement: ["star", "confetti", "sparkle"],
  "streak-bubbly": ["bubble", "droplet"],
  "streak-fire": ["flame", "sparkle"],
  "streak-disco": ["confetti", "note", "sparkle"],
};

const CONFETTI_COLORS = [0xff0080, 0x7928ca, 0x00b4ff, 0x2af598, 0xffd200];

function buildShapeContexts(
  PIXI: typeof import("pixi.js"),
): Record<ShapeName, GraphicsContext> {
  const ctx = () => new PIXI.GraphicsContext();
  return {
    // Water drop: round belly, tip curling up.
    droplet: ctx()
      .moveTo(0, -9)
      .bezierCurveTo(4.5, -3, 6, 0, 6, 3)
      .arc(0, 3, 6, 0, Math.PI)
      .bezierCurveTo(-6, 0, -4.5, -3, 0, -9)
      .closePath()
      .fill(0x2bb8ff)
      .circle(-2, 2, 1.6)
      .fill({ color: 0xffffff, alpha: 0.85 }),
    bubble: ctx()
      .circle(0, 0, 6)
      .fill({ color: 0xffffff, alpha: 0.2 })
      .stroke({ width: 1.6, color: 0xffffff, alpha: 0.95 })
      .arc(-1.5, -1.5, 3.4, Math.PI * 0.95, Math.PI * 1.45)
      .stroke({ width: 1.3, color: 0xffffff, cap: "round" }),
    sparkle: ctx().star(0, 0, 4, 8, 2.6).fill(0xfff2a1),
    snowflake: (() => {
      const c = ctx();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        c.moveTo(0, 0).lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
        // Little side barbs halfway along each spoke.
        const bx = Math.cos(a) * 5;
        const by = Math.sin(a) * 5;
        c.moveTo(bx, by).lineTo(
          bx + Math.cos(a + 0.9) * 2.6,
          by + Math.sin(a + 0.9) * 2.6,
        );
        c.moveTo(bx, by).lineTo(
          bx + Math.cos(a - 0.9) * 2.6,
          by + Math.sin(a - 0.9) * 2.6,
        );
      }
      return c.stroke({ width: 1.5, color: 0xdff4ff, cap: "round" });
    })(),
    flame: ctx()
      .moveTo(-5, 6)
      .bezierCurveTo(-7, 2.5, -3.5, 0.5, -0.5, -6)
      .bezierCurveTo(-0.2, -2, 2.5, -1.5, 3.5, 1)
      .bezierCurveTo(6.5, 2.5, 5, 5, 5, 6)
      .closePath()
      .fill(0xf97316)
      .moveTo(-2, 6)
      .bezierCurveTo(-3, 4, -1.5, 2.5, 0, 0)
      .bezierCurveTo(1.5, 2.5, 3, 4, 2, 6)
      .closePath()
      .fill(0xfde047),
    star: ctx()
      .star(0, 0, 5, 8, 3.8)
      .fill(0xfbbf24)
      .stroke({ width: 1, color: 0xd97706 }),
    // White so each instance gets its own tint.
    confetti: ctx().roundRect(-4.5, -3, 9, 6, 1.5).fill(0xffffff),
    note: ctx()
      .ellipse(-3.5, 6, 3.2, 2.4)
      .fill(0xffffff)
      .rect(-1, -6, 1.6, 12)
      .fill(0xffffff)
      .moveTo(-1, -6)
      .bezierCurveTo(3, -5.5, 4, -3.5, 6, -1.5)
      .bezierCurveTo(4.5, -4.5, 4, -5.5, 0.6, -7)
      .closePath()
      .fill(0xffffff),
  };
}

export const burstFx: PixiFx = (PIXI, app, { variant }) => {
  const shapes = buildShapeContexts(PIXI);
  const mix = VARIANT_SHAPES[String(variant)] ?? VARIANT_SHAPES.swim;
  const cx = app.screen.width / 2;
  const cy = app.screen.height / 2;

  const COUNT = 26;
  const parts = Array.from({ length: COUNT }, (_, i) => {
    // Hero shape on every even slot, supporting shapes rotate on the odd.
    const name = i % 2 === 0 ? mix[0] : mix[1 + ((i >> 1) % (mix.length - 1))];
    const g = new PIXI.Graphics(shapes[name]);
    if (name === "confetti")
      g.tint = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    if (name === "sparkle" || name === "star") g.blendMode = "add";
    g.x = cx;
    g.y = cy;
    g.alpha = 0;
    app.stage.addChild(g);
    const angle = (i / COUNT) * Math.PI * 2 + rand(-0.25, 0.25);
    const speed = rand(3.2, 7.5);
    return {
      g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(0.5, 1.5),
      spin: rand(-0.12, 0.12),
      scale: rand(0.8, 1.6),
      delay: i * 14, // ms — staggered ignition around the ring
      age: 0,
    };
  });

  const LIFE = 1600; // ms
  let elapsed = 0;
  const tick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    let alive = false;
    for (const p of parts) {
      const age = elapsed - p.delay;
      if (age < 0) {
        alive = true;
        continue;
      }
      if (age > LIFE) {
        p.g.visible = false;
        continue;
      }
      alive = true;
      const dt = ticker.deltaTime;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vx *= Math.pow(0.94, dt); // friction
      p.vy = p.vy * Math.pow(0.96, dt) + 0.14 * dt; // gravity takes over
      p.g.rotation += p.spin * dt;
      const life = age / LIFE;
      p.g.scale.set(p.scale * Math.min(1, age / 160)); // pop in
      p.g.alpha =
        life < 0.12 ? life / 0.12 : life > 0.65 ? 1 - (life - 0.65) / 0.35 : 1;
    }
    if (!alive) app.ticker.remove(tick); // burst over — stop mutating
  };
  app.ticker.add(tick);
  return () => app.ticker.remove(tick);
};
