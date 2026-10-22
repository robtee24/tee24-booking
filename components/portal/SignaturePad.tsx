"use client";

import React from "react";

export type SignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  /** PNG data URL of the drawn strokes (transparent background). */
  toDataUrl: () => string | null;
  /** SVG data URL (base64) built from the recorded strokes — crisp at any size. */
  toSvgDataUrl: () => string | null;
};

type Point = { x: number; y: number };

/**
 * Pointer-based signature pad. Records strokes so we can emit both PNG
 * (canvas) and SVG (paths) representations.
 */
export const SignaturePad = React.forwardRef<SignaturePadHandle, { height?: number; label?: string; onChange?: (empty: boolean) => void; className?: string }>(
  function SignaturePad({ height = 160, label = "Sign here", onChange, className = "" }, ref) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const strokes = React.useRef<Point[][]>([]);
    const drawing = React.useRef(false);
    const [empty, setEmpty] = React.useState(true);

    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 1;

    const redraw = React.useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#111";
      for (const s of strokes.current) {
        if (s.length === 0) continue;
        ctx.beginPath();
        ctx.moveTo(s[0]!.x, s[0]!.y);
        if (s.length === 1) ctx.lineTo(s[0]!.x + 0.1, s[0]!.y + 0.1);
        for (let i = 1; i < s.length; i++) {
          const p = s[i]!;
          const q = s[i - 1]!;
          const mx = (p.x + q.x) / 2;
          const my = (p.y + q.y) / 2;
          ctx.quadraticCurveTo(q.x, q.y, mx, my);
        }
        ctx.stroke();
      }
    }, [dpr]);

    // Size the canvas to its CSS box (HiDPI aware) and redraw on resize.
    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        redraw();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      return () => ro.disconnect();
    }, [dpr, redraw]);

    const pos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const rect = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      strokes.current.push([pos(e)]);
      redraw();
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      e.preventDefault();
      strokes.current[strokes.current.length - 1]!.push(pos(e));
      redraw();
    };
    const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      drawing.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      const nowEmpty = strokes.current.every((s) => s.length < 2);
      setEmpty(nowEmpty);
      onChange?.(nowEmpty);
    };

    React.useImperativeHandle(ref, () => ({
      clear: () => {
        strokes.current = [];
        setEmpty(true);
        onChange?.(true);
        redraw();
      },
      isEmpty: () => strokes.current.every((s) => s.length < 2),
      toDataUrl: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokes.current.every((s) => s.length < 2)) return null;
        return canvas.toDataURL("image/png");
      },
      toSvgDataUrl: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokes.current.every((s) => s.length < 2)) return null;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const paths = strokes.current
          .filter((s) => s.length > 0)
          .map((s) => {
            let d = `M${s[0]!.x.toFixed(1)} ${s[0]!.y.toFixed(1)}`;
            if (s.length === 1) d += ` l0.1 0.1`;
            for (let i = 1; i < s.length; i++) {
              const p = s[i]!;
              const q = s[i - 1]!;
              d += ` Q${q.x.toFixed(1)} ${q.y.toFixed(1)} ${((p.x + q.x) / 2).toFixed(1)} ${((p.y + q.y) / 2).toFixed(1)}`;
            }
            return `<path d="${d}" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
          })
          .join("");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}</svg>`;
        return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      },
    }));

    return (
      <div className={`relative ${className}`}>
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: "none" }}
          className="block w-full cursor-crosshair rounded-apple-sm border border-apple-border bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          aria-label={label}
          role="img"
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4 text-apple-sm text-apple-text-tertiary">
            <span className="border-t border-dashed border-apple-border px-12 pt-1">{label}</span>
          </div>
        )}
      </div>
    );
  },
);
