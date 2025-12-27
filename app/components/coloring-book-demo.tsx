"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import GSAPImageCompareSliderDemo from "./slider";

const MAX_EDGE = 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEFAULT_RATIO = 3 / 2;
const CUSTOM_ID = "custom";
const RATIO_CANDIDATES = [
  { label: "1:1", value: 1 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
];

type GenerationStatus = "idle" | "loading" | "ready" | "error";

type Stage = "upload" | "preview" | "result";

type ProcessedImage = {
  id: string;
  blob?: Blob;
  previewUrl: string;
  width: number;
  height: number;
  ratioLabel: string;
  ratioValue: number;
  name: string;
  sourceUrl?: string;
  isObjectUrl: boolean;
};

type SampleSet = {
  id: string;
  name: string;
  ratioLabel: string;
  ratioValue: number;
  originalSrc: string;
  generatedSrc: string;
};

const SAMPLES: SampleSet[] = [
  {
    id: "sample-01",
    name: "Alpine Lake",
    ratioLabel: "3:2",
    ratioValue: DEFAULT_RATIO,
    originalSrc: "/samples/sample-01-original.jpg",
    generatedSrc: "/samples/sample-01-line.png",
  },
  {
    id: "sample-02",
    name: "City Walk",
    ratioLabel: "3:2",
    ratioValue: DEFAULT_RATIO,
    originalSrc: "/samples/sample-02-original.jpg",
    generatedSrc: "/samples/sample-02-line.png",
  },
  {
    id: "sample-03",
    name: "Desert Road",
    ratioLabel: "3:2",
    ratioValue: DEFAULT_RATIO,
    originalSrc: "/samples/sample-03-original.jpg",
    generatedSrc: "/samples/sample-03-line.png",
  },
];

const pickRatio = (ratio: number) => {
  return RATIO_CANDIDATES.reduce((closest, candidate) => {
    const currentDelta = Math.abs(candidate.value - ratio);
    const closestDelta = Math.abs(closest.value - ratio);
    return currentDelta < closestDelta ? candidate : closest;
  }, RATIO_CANDIDATES[0]);
};

const createPlaceholder = (ratio: number) => {
  const base = 1600;
  const width = ratio >= 1 ? base : Math.round(base * ratio);
  const height = ratio >= 1 ? Math.round(base / ratio) : base;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
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
      <rect width="${width}" height="${height}" fill="url(#paper)"/>
      <rect width="${width}" height="${height}" fill="url(#vignette)"/>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const loadImage = (file: File) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = async () => {
      try {
        if (image.decode) {
          await image.decode();
        }
      } catch {
        // Ignore decode errors and rely on the loaded element.
      } finally {
        URL.revokeObjectURL(url);
      }

      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("We couldn't read that image."));
    };

    image.src = url;
  });
};

const buildProcessedImage = async (file: File): Promise<ProcessedImage> => {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("That image doesn't have valid dimensions.");
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const target = pickRatio(sourceRatio);

  const targetWidth =
    target.value >= 1 ? MAX_EDGE : Math.round(MAX_EDGE * target.value);
  const targetHeight =
    target.value >= 1 ? Math.round(MAX_EDGE / target.value) : MAX_EDGE;

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > target.value) {
    cropWidth = Math.round(sourceHeight * target.value);
    cropX = Math.round((sourceWidth - cropWidth) / 2);
  } else if (sourceRatio < target.value) {
    cropHeight = Math.round(sourceWidth / target.value);
    cropY = Math.round((sourceHeight - cropHeight) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error("We couldn't prepare that image."));
          return;
        }
        resolve(result);
      },
      "image/jpeg",
      0.92
    );
  });

  const previewUrl = URL.createObjectURL(blob);
  const baseName = file.name.replace(/\.[^/.]+$/, "").trim() || "photo";

  return {
    id: CUSTOM_ID,
    blob,
    previewUrl,
    width: targetWidth,
    height: targetHeight,
    ratioLabel: target.label,
    ratioValue: target.value,
    name: `${baseName}-cropped.jpg`,
    isObjectUrl: true,
  };
};

export default function ColoringBookDemo() {
  const [stage, setStage] = useState<Stage>("upload");
  const [processed, setProcessed] = useState<ProcessedImage | null>(null);
  const [selectedId, setSelectedId] = useState<string>(CUSTOM_ID);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [generatedSrc, setGeneratedSrc] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const previewUrl = processed?.previewUrl;
    const isObjectUrl = processed?.isObjectUrl;

    return () => {
      if (previewUrl && isObjectUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [processed?.previewUrl, processed?.isObjectUrl]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setFrameSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const ratioValue = processed?.ratioValue ?? DEFAULT_RATIO;
  const placeholder = useMemo(() => createPlaceholder(ratioValue), [ratioValue]);
  const fitStyle = useMemo<CSSProperties>(() => {
    if (!frameSize.width || !frameSize.height) {
      return { width: "100%", height: "100%" };
    }

    let fitWidth = frameSize.width;
    let fitHeight = fitWidth / ratioValue;

    if (fitHeight > frameSize.height) {
      fitHeight = frameSize.height;
      fitWidth = fitHeight * ratioValue;
    }

    return {
      width: Math.round(fitWidth),
      height: Math.round(fitHeight),
    };
  }, [frameSize, ratioValue]);

  const preloadSampleBlob = useCallback(async (sample: SampleSet) => {
    try {
      const response = await fetch(sample.originalSrc);
      if (!response.ok) return;
      const blob = await response.blob();
      setProcessed((prev) =>
        prev && prev.id === sample.id ? { ...prev, blob } : prev
      );
    } catch {
      // Ignore sample prefetch errors.
    }
  }, []);

  const ensureSourceBlob = useCallback(async (image: ProcessedImage) => {
    if (image.blob) return image.blob;
    if (!image.sourceUrl) {
      throw new Error("Missing source image.");
    }

    const response = await fetch(image.sourceUrl);
    if (!response.ok) {
      throw new Error("Failed to load the source image.");
    }

    const blob = await response.blob();
    setProcessed((prev) =>
      prev && prev.id === image.id ? { ...prev, blob } : prev
    );
    return blob;
  }, []);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const selectSample = useCallback(
    (sample: SampleSet) => {
      abortRef.current?.abort();
      setSelectedId(sample.id);
      setStage("result");
      setProcessed({
        id: sample.id,
        previewUrl: sample.originalSrc,
        width: 0,
        height: 0,
        ratioLabel: sample.ratioLabel,
        ratioValue: sample.ratioValue,
        name: `${sample.id}.jpg`,
        sourceUrl: sample.originalSrc,
        isObjectUrl: false,
      });
      setGeneratedSrc(sample.generatedSrc);
      setBlobUrl(null);
      setStatus("ready");
      setGenerationError(null);
      setUploadError(null);
      setIsDragging(false);
      preloadSampleBlob(sample);
    },
    [preloadSampleBlob]
  );

  const handleFile = useCallback(async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError("Upload a JPG, PNG, or WebP image.");
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setUploadError("Please choose an image under 12MB.");
      return;
    }

    abortRef.current?.abort();
    setSelectedId(CUSTOM_ID);
    setIsProcessing(true);
    setUploadError(null);
    setIsDragging(false);

    try {
      const prepared = await buildProcessedImage(file);
      setProcessed(prepared);
      setGeneratedSrc(null);
      setBlobUrl(null);
      setStatus("idle");
      setGenerationError(null);
      setStage("preview");
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "We couldn't use that image."
      );
      setStage("upload");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      event.target.value = "";
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const generate = useCallback(async () => {
    if (!processed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStage("result");
    setStatus("loading");
    setGenerationError(null);
    setBlobUrl(null);

    try {
      const sourceBlob = await ensureSourceBlob(processed);
      const formData = new FormData();
      formData.append("image", sourceBlob, processed.name);
      formData.append("aspectRatio", processed.ratioLabel);

      const response = await fetch("/api/coloring", {
        method: "POST",
        body: formData,
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
      setGenerationError(
        error instanceof Error ? error.message : "Generation failed."
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [ensureSourceBlob, processed]);

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
            {generationError ?? "Try again in a moment."}
          </div>
        </div>
      </div>
    ) : null;

  const processingOverlay = isProcessing ? (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-white/80 backdrop-blur">
      <div className="flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-700 shadow-lg">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        Preparing photo
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
          Drop a photo, we crop it to a classic ratio, and the AI turns it into
          crisp line art. Drag to compare once it renders.
        </p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[10rem_minmax(0,1fr)_10rem] lg:items-center">
        <div className="flex w-full justify-center lg:col-start-1 lg:self-center">
          <div className="grid w-full max-w-[520px] grid-cols-4 gap-3 lg:max-w-none lg:grid-cols-1 lg:gap-4">
            <button
              type="button"
              onClick={openPicker}
              aria-label="Upload your own photo"
              className={`group relative aspect-[3/2] w-full overflow-hidden rounded-2xl border-2 border-dashed bg-white/80 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                selectedId === CUSTOM_ID
                  ? "border-amber-400/80 ring-2 ring-amber-400/80"
                  : "border-neutral-200/80 ring-1 ring-black/5"
              }`}
            >
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-neutral-600">
                +
              </div>
            </button>
            {SAMPLES.map((sample) => {
              const isActive = selectedId === sample.id;
              return (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => selectSample(sample)}
                  aria-label={`Use sample ${sample.name}`}
                  className={`group relative aspect-[3/2] w-full overflow-hidden rounded-2xl border border-white/70 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    isActive ? "ring-2 ring-amber-400/80" : "ring-1 ring-black/5"
                  }`}
                >
                  <img
                    src={sample.generatedSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    src={sample.originalSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ clipPath: "inset(0 50% 0 0)" }}
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 lg:col-start-2">
          <div
            ref={frameRef}
            className="relative flex h-[clamp(300px,56vh,720px)] items-center justify-center"
          >
            {stage === "upload" ? (
              <div
                className={`relative flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition ${
                  isDragging
                    ? "border-amber-300/80 bg-amber-50/70"
                    : "border-neutral-200/80 bg-white/80"
                }`}
                style={fitStyle}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={openPicker}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openPicker();
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow">
                  <span className="text-xl font-semibold text-neutral-700">
                    +
                  </span>
                </div>
                <div className="text-base font-semibold text-neutral-800">
                  Drag & drop your photo
                </div>
                <div className="text-xs uppercase tracking-[0.3em] text-neutral-500">
                  JPG, PNG, or WebP
                </div>
                {uploadError ? (
                  <div className="text-xs text-rose-500">{uploadError}</div>
                ) : (
                  <div className="text-xs text-neutral-500">
                    Click anywhere to browse.
                  </div>
                )}
              </div>
            ) : stage === "preview" ? (
              <div
                className="relative overflow-hidden rounded-3xl bg-neutral-900/5 shadow-lg"
                style={fitStyle}
              >
                <img
                  src={processed?.previewUrl ?? placeholder}
                  alt="Prepared upload"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-900/40 to-transparent px-6 py-5">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white">
                    <span className="h-2 w-2 rounded-full bg-amber-300" />
                    Cropped to {processed?.ratioLabel}
                  </div>
                </div>
              </div>
            ) : (
              <div style={fitStyle} className="flex items-center justify-center">
                <GSAPImageCompareSliderDemo
                  className="relative"
                  beforeSrc={processed?.previewUrl ?? placeholder}
                  afterSrc={generatedSrc ?? placeholder}
                  aspectRatio={ratioValue}
                  overlay={overlay}
                />
              </div>
            )}
            {processingOverlay}
          </div>
        </div>
        <div className="hidden lg:block" />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {stage === "upload" ? (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-neutral-900 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-50 shadow-lg shadow-neutral-900/15 transition hover:-translate-y-0.5 hover:shadow-neutral-900/25"
          >
            Choose photo
          </button>
        ) : stage === "preview" ? (
          <>
            <button
              type="button"
              onClick={generate}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-neutral-900 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-50 shadow-lg shadow-neutral-900/15 transition hover:-translate-y-0.5 hover:shadow-neutral-900/25 disabled:translate-y-0 disabled:opacity-60"
            >
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              Generate
            </button>
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-white px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Replace photo
            </button>
          </>
        ) : (
          <>
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
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-white px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Replace photo
            </button>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg, image/png, image/webp"
        className="hidden"
        onChange={handleInputChange}
      />
    </section>
  );
}
