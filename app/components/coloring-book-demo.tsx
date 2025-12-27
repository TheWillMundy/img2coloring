"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GSAPImageCompareSliderDemo from "./slider";

const ORIGINAL_IMAGE =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&h=900&q=80";
const SOURCE_IMAGE =
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1024&h=576&q=80";

type GenerationStatus = "idle" | "loading" | "ready" | "error";

export default function ColoringBookDemo() {
  const [generatedSrc, setGeneratedSrc] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const hasRequestedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const placeholder = useMemo(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
        <defs>
          <linearGradient id="paper" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#f8f3ea"/>
            <stop offset="100%" stop-color="#eee3d2"/>
          </linearGradient>
          <radialGradient id="vignette" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
            <stop offset="100%" stop-color="#cbbfae" stop-opacity="0.35"/>
          </radialGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#paper)"/>
        <rect width="1600" height="900" fill="url(#vignette)"/>
      </svg>
    `;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, []);

  const generate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setError(null);
    setBlobUrl(null);

    try {
      const response = await fetch("/api/coloring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageUrl: SOURCE_IMAGE }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Generation failed.");
      }

      setGeneratedSrc(data.image);
      setBlobUrl(typeof data?.blobUrl === "string" ? data.blobUrl : null);
      setStatus("ready");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }

      setStatus("error");
      setError(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;
    generate();

    return () => {
      abortRef.current?.abort();
    };
  }, [generate]);

  const handleDownload = useCallback(async () => {
    if (!generatedSrc) return;

    const source = blobUrl ?? generatedSrc;
    const filename = source.startsWith("data:image/webp")
      ? "coloring-book.webp"
      : source.startsWith("data:image/jpeg")
        ? "coloring-book.jpg"
        : "coloring-book.png";

    try {
      if (source.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = source;
        link.download = filename;
        link.click();
        return;
      }

      const response = await fetch(source);
      if (!response.ok) {
        throw new Error("Download failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error("Download failed:", downloadError);
    }
  }, [blobUrl, generatedSrc]);

  const canDownload = status === "ready" && Boolean(generatedSrc);

  const overlay =
    status === "loading" ? (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 backdrop-blur-sm">
        <div className="flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-700 shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Generating line art
        </div>
      </div>
    ) : status === "error" ? (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/75 backdrop-blur-sm">
        <div className="max-w-sm text-center">
          <div className="text-sm font-semibold text-neutral-800">
            Image generation failed.
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            {error ?? "Try again in a moment."}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <section className="relative">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-neutral-500">
          img2coloringbook
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-neutral-900 sm:text-5xl md:text-6xl">
          Turn photos into pencil-ready pages.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-neutral-600 sm:text-base">
          We start with a single Unsplash scene and translate it into crisp,
          printable line art. Drag to compare the original against the AI
          coloring book render.
        </p>
      </header>

      <div className="relative mt-10 rounded-[32px] border border-white/70 bg-white/70 p-4 shadow-[0_25px_80px_rgba(17,12,8,0.2)] backdrop-blur">
        <div className="pointer-events-none absolute -inset-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_30%,rgba(255,255,255,0.7),rgba(255,255,255,0))]" />
        <GSAPImageCompareSliderDemo
          className="relative"
          beforeSrc={ORIGINAL_IMAGE}
          afterSrc={generatedSrc ?? placeholder}
          title="Original -> Coloring Book"
          subtitle="Drag to scrub, tap to jump, flick to glide"
          credit="Unsplash sample"
          tip="Tip: the right side is generated with the Vercel AI SDK."
          overlay={overlay}
        />
      </div>

      <div className="mt-6 flex flex-col items-center justify-between gap-4 text-xs text-neutral-500 sm:flex-row">
        <div className="flex items-center gap-3 uppercase tracking-[0.3em]">
          <span className="h-2 w-2 rounded-full bg-amber-500/80" />
          Original / Generated
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-end">
          <button
            type="button"
            onClick={generate}
            disabled={status === "loading"}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-neutral-900 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-50 shadow-lg shadow-neutral-900/15 transition hover:-translate-y-0.5 hover:shadow-neutral-900/25 disabled:translate-y-0 disabled:opacity-60"
          >
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            {status === "loading" ? "Rendering" : "Regenerate"}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-white px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:translate-y-0 disabled:opacity-50"
          >
            Download
          </button>
          <span className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
            {status === "ready"
              ? blobUrl
                ? "Saved to Vercel Blob"
                : "Generated with the configured image model"
              : "Awaiting render"}
          </span>
        </div>
      </div>
    </section>
  );
}
