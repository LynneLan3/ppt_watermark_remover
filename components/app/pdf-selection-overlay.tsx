"use client";

import { useMemo, useState } from "react";

import type { NormalizedRect } from "@/lib/local/pdf/types";

type Point = { x: number; y: number };

type PdfSelectionOverlayProps = {
  width: number;
  height: number;
  selection: NormalizedRect | null;
  onSelectionChange: (rect: NormalizedRect | null) => void;
  enabled: boolean;
};

export function PdfSelectionOverlay({
  width,
  height,
  selection,
  onSelectionChange,
  enabled,
}: PdfSelectionOverlayProps) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);

  const drawingRect = useMemo(() => {
    if (!dragStart || !dragCurrent) {
      return null;
    }
    return normalizeRect(dragStart, dragCurrent, width, height);
  }, [dragStart, dragCurrent, width, height]);

  const activeRect = drawingRect ?? selection;

  return (
    <div
      className={`absolute inset-0 ${enabled ? "cursor-crosshair" : "cursor-default"}`}
      onPointerDown={(event) => {
        if (!enabled) {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const start = {
          x: clamp(event.clientX - rect.left, 0, rect.width),
          y: clamp(event.clientY - rect.top, 0, rect.height),
        };
        setDragStart(start);
        setDragCurrent(start);
      }}
      onPointerMove={(event) => {
        if (!enabled || !dragStart) {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setDragCurrent({
          x: clamp(event.clientX - rect.left, 0, rect.width),
          y: clamp(event.clientY - rect.top, 0, rect.height),
        });
      }}
      onPointerUp={() => {
        if (drawingRect && drawingRect.width > 0.005 && drawingRect.height > 0.005) {
          onSelectionChange(drawingRect);
        }
        setDragStart(null);
        setDragCurrent(null);
      }}
      onPointerLeave={() => {
        if (!dragStart) {
          return;
        }
        setDragStart(null);
        setDragCurrent(null);
      }}
    >
      {activeRect ? (
        <div
          className="absolute border-2 border-sky-500 bg-sky-400/15"
          style={{
            left: `${activeRect.x * 100}%`,
            top: `${activeRect.y * 100}%`,
            width: `${activeRect.width * 100}%`,
            height: `${activeRect.height * 100}%`,
          }}
        />
      ) : null}

      {selection ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectionChange(null);
          }}
          className="absolute right-2 top-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function normalizeRect(
  start: Point,
  end: Point,
  width: number,
  height: number,
): NormalizedRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);

  return {
    x: safeDivide(left, width),
    y: safeDivide(top, height),
    width: safeDivide(right - left, width),
    height: safeDivide(bottom - top, height),
  };
}

function safeDivide(value: number, base: number) {
  if (base <= 0) {
    return 0;
  }
  return value / base;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
