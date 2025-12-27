"use client";

import { type ReactNode, useEffect, useMemo, useRef } from "react";
import gsap from "gsap";

/**
 * GSAP before/after slider that behaves predictably AND supports a subtle "flick" inertia.
 *
 * Core rule (keeps it jolt-free):
 * - While dragging: DIRECT updates (no tween)
 * - Tap/click: ONE tween to target
 * - On drag release: optional inertia tween (only if there was real drag velocity)
 */

type SliderProps = {
  beforeSrc: string;
  afterSrc: string;
  title?: string;
  subtitle?: string;
  credit?: string;
  tip?: string;
  className?: string;
  overlay?: ReactNode;
};

export default function GSAPImageCompareSliderDemo({
  beforeSrc,
  afterSrc,
  title,
  subtitle,
  credit,
  tip,
  className,
  overlay,
}: SliderProps) {
  const images = useMemo(
    () => ({
      before: beforeSrc,
      after: afterSrc,
    }),
    [beforeSrc, afterSrc]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const rangeRef = useRef<HTMLInputElement | null>(null);

  const proxyRef = useRef({ p: 0.5 }); // 0..1
  const sizeRef = useRef({ w: 0, handleW: 44 });

  const clickTweenRef = useRef<gsap.core.Tween | null>(null);
  const inertiaTweenRef = useRef<gsap.core.Tween | null>(null);

  const stateRef = useRef({
    down: false,
    moved: false,
    startX: 0,
    samples: 0,
    lastP: 0.5,
    lastT: 0,
    v: 0, // p per ms
  });

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const render = (p: number) => {
    const overlay = overlayImgRef.current;
    const handle = handleRef.current;
    if (!overlay || !handle) return;

    const w = sizeRef.current.w;
    const handleW = sizeRef.current.handleW;
    if (!w) return;

    const pp = clamp01(p);

    // Pixel-based inset avoids percent rounding jitter.
    const rightPx = Math.max(0, w - pp * w);
    overlay.style.clipPath = `inset(0px ${rightPx}px 0px 0px)`;

    const x = pp * w - handleW / 2;
    gsap.set(handle, { x });
  };

  const killClickTween = () => {
    if (clickTweenRef.current) {
      clickTweenRef.current.kill();
      clickTweenRef.current = null;
    }
  };

  const killInertiaTween = () => {
    if (inertiaTweenRef.current) {
      inertiaTweenRef.current.kill();
      inertiaTweenRef.current = null;
    }
  };

  const setImmediate = (p: number) => {
    proxyRef.current.p = clamp01(p);
    render(proxyRef.current.p);
  };

  const tweenTo = (p: number) => {
    const target = clamp01(p);
    killClickTween();
    clickTweenRef.current = gsap.to(proxyRef.current, {
      p: target,
      duration: 0.22,
      ease: "power3.out",
      overwrite: true,
      onUpdate: () => render(proxyRef.current.p),
      onComplete: () => {
        clickTweenRef.current = null;
      },
    });
  };

  // Measure sizes + keep updated.
  useEffect(() => {
    const container = containerRef.current;
    const handle = handleRef.current;
    if (!container || !handle) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      const hRect = handle.getBoundingClientRect();
      sizeRef.current.w = rect.width;
      sizeRef.current.handleW = hRect.width || 44;
      render(proxyRef.current.p);
    };

    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    requestAnimationFrame(() => measure());

    gsap.fromTo(
      container,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
    );

    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Range -> visuals
  useEffect(() => {
    const range = rangeRef.current;
    if (!range) return;

    const readP = () => clamp01(Number(range.value) / 10000);
    const writeRange = (p: number) => {
      range.value = String(Math.round(clamp01(p) * 10000));
    };

    // Align range with proxy (initial render).
    writeRange(proxyRef.current.p);

    const onPointerDown = (e: PointerEvent) => {
      if (typeof e.button === "number" && e.button !== 0) return;

      // New interaction always cancels any running tweens.
      killClickTween();
      killInertiaTween();

      const s = stateRef.current;
      s.down = true;
      s.moved = false;
      s.samples = 0;
      s.startX = e.clientX;

      const p0 = readP();
      s.lastP = p0;
      s.lastT = performance.now();
      s.v = 0;

      gsap.to(handleRef.current, {
        scale: 1.04,
        duration: 0.12,
        ease: "power2.out",
        overwrite: true,
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.down) return;

      // Mark as drag once there's real movement.
      if (!s.moved && Math.abs(e.clientX - s.startX) > 3) {
        s.moved = true;
        killClickTween();
        killInertiaTween();
      }
    };

    const onPointerUp = () => {
      const s = stateRef.current;
      const wasDrag = s.moved;
      const v = s.v;

      s.down = false;
      s.moved = false;
      s.samples = 0;

      gsap.to(handleRef.current, {
        scale: 1,
        duration: 0.15,
        ease: "power2.out",
        overwrite: true,
      });

      // If it was a drag, snap proxy to the final range value.
      if (wasDrag) {
        const pNow = readP();
        setImmediate(pNow);

        // Subtle inertia only if there was meaningful velocity.
        // v is in p/ms; typical values are small (~1e-4). We project a short window.
        if (Math.abs(v) > 0.0006) {
          const projectionMs = 180;
          const target = clamp01(proxyRef.current.p + v * projectionMs);

          // Duration scales gently with speed.
          const dur = gsap.utils.clamp(0.22, 0.6, 0.28 + Math.abs(v) * 220);

          killInertiaTween();
          inertiaTweenRef.current = gsap.to(proxyRef.current, {
            p: target,
            duration: dur,
            ease: "power3.out",
            overwrite: true,
            onUpdate: () => {
              render(proxyRef.current.p);
              // Keep thumb consistent during inertia (setting value does NOT fire input).
              writeRange(proxyRef.current.p);
            },
            onComplete: () => {
              inertiaTweenRef.current = null;
            },
          });
        }
      }
    };

    const onInput = () => {
      const s = stateRef.current;
      const p = readP();

      // Update velocity estimate while pressed.
      if (s.down) {
        const now = performance.now();
        const dt = Math.max(1, now - s.lastT);
        const dp = p - s.lastP;

        // Exponential moving average to smooth noise.
        const instV = dp / dt;
        s.v = s.v * 0.65 + instV * 0.35;

        s.lastP = p;
        s.lastT = now;
        s.samples += 1;

        // If we see multiple samples while down, it's effectively a drag.
        if (s.samples > 1 && !s.moved) {
          s.moved = true;
          killClickTween();
          killInertiaTween();
        }
      }

      // Drag: immediate, no lag.
      if (s.down && s.moved) {
        setImmediate(p);
        return;
      }

      // Tap/click: single smooth tween.
      tweenTo(p);
    };

    range.addEventListener("pointerdown", onPointerDown);
    range.addEventListener("pointermove", onPointerMove);
    range.addEventListener("pointerup", onPointerUp);
    range.addEventListener("pointercancel", onPointerUp);

    range.addEventListener("input", onInput);

    const onBlur = () => {
      stateRef.current.down = false;
      stateRef.current.moved = false;
      stateRef.current.samples = 0;
      stateRef.current.v = 0;
      gsap.set(handleRef.current, { scale: 1 });
      killClickTween();
      killInertiaTween();
    };
    window.addEventListener("blur", onBlur);

    return () => {
      range.removeEventListener("pointerdown", onPointerDown);
      range.removeEventListener("pointermove", onPointerMove);
      range.removeEventListener("pointerup", onPointerUp);
      range.removeEventListener("pointercancel", onPointerUp);
      range.removeEventListener("input", onInput);
      window.removeEventListener("blur", onBlur);
      killClickTween();
      killInertiaTween();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootClassName = className ? `w-full ${className}` : "w-full";
  const hasHeader = Boolean(title || subtitle || credit);

  return (
    <div className={rootClassName}>
      {hasHeader ? (
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            {title ? <div className="text-xl font-semibold">{title}</div> : null}
            {subtitle ? <div className="text-sm text-neutral-500">{subtitle}</div> : null}
          </div>
          {credit ? <div className="text-xs text-neutral-500">{credit}</div> : null}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-3xl shadow-lg bg-neutral-100 select-none"
        style={{
          aspectRatio: "16 / 9",
          touchAction: "none",
          cursor: "ew-resize",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        aria-label="Image comparison slider"
      >
        <img
          src={images.after}
          alt="After"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ pointerEvents: "none" }}
          draggable={false}
          decoding="async"
          loading="eager"
        />

        <img
          ref={overlayImgRef}
          src={images.before}
          alt="Before"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            clipPath: "inset(0 50% 0 0)",
            willChange: "clip-path",
            pointerEvents: "none",
          }}
          draggable={false}
          decoding="async"
          loading="eager"
        />

        <div
          ref={handleRef}
          className="absolute top-0 bottom-0 z-10 pointer-events-none"
          style={{ width: 44, willChange: "transform" }}
          aria-hidden
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-white/80 shadow" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="flex items-center gap-2 rounded-full bg-white/90 backdrop-blur px-3 py-2 shadow-lg">
              <div className="h-2 w-2 rounded-full bg-neutral-900/70" />
              <div className="text-[11px] font-medium tracking-wide text-neutral-700">DRAG</div>
              <div className="h-2 w-2 rounded-full bg-neutral-900/70" />
            </div>
          </div>
        </div>

        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={10000}
          step={1}
          defaultValue={5000}
          className="absolute inset-0 z-20 w-full h-full opacity-0"
          style={{
            touchAction: "none",
            WebkitAppearance: "none",
            appearance: "none",
            background: "transparent",
          }}
          aria-label="Comparison slider"
        />

        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]" />
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(80%_80%_at_50%_50%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.18)_100%)] opacity-40" />
        {overlay}
      </div>

      {tip ? <div className="mt-3 text-xs text-neutral-500">{tip}</div> : null}
    </div>
  );
}
