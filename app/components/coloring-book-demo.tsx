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
import {
  deleteImageRecord,
  getImageRecord,
  saveImageRecord,
} from "../lib/image-store";

const MAX_EDGE = 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEFAULT_RATIO = 3 / 2;
const CUSTOM_ID = "custom";
const DEFAULT_MODEL = "openai/gpt-image-1.5";
const SETTINGS_STORAGE_KEY = "etch.settings.v1";
const UPLOADS_STORAGE_KEY = "etch.uploads.v1";
const SELECTED_STORAGE_KEY = "etch.selected.v1";
const FREE_GENERATION_KEY = "etch.free-generation-used.v1";
const PENDING_GENERATION_KEY = "etch.pending-generation.v1";
const RATIO_CANDIDATES = [
  { label: "1:1", value: 1 },
  { label: "3:2", value: 3 / 2 },
  { label: "2:3", value: 2 / 3 },
];
const MAX_RATIO = Math.max(...RATIO_CANDIDATES.map((ratio) => ratio.value));

type GenerationStatus = "idle" | "loading" | "ready" | "error";

type Stage = "upload" | "preview" | "result";

type ProviderName = "openai" | "google";

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
};

type ProcessedImageWithBlob = ProcessedImage & { blob: Blob };

type SampleSet = {
  id: string;
  name: string;
  ratioLabel: string;
  ratioValue: number;
  originalSrc: string;
  generatedSrc: string;
};

type UploadMeta = {
  id: string;
  name: string;
  ratioLabel: string;
  ratioValue: number;
  createdAt: number;
  updatedAt: number;
  hasGenerated: boolean;
};

type UploadPanel = UploadMeta & {
  originalUrl?: string;
  generatedUrl?: string;
};

type UserSettings = {
  imageModel: string;
  openaiApiKey: string;
  googleApiKey: string;
};

const DEFAULT_SETTINGS: UserSettings = {
  imageModel: DEFAULT_MODEL,
  openaiApiKey: "",
  googleApiKey: "",
};

const MODEL_OPTIONS = [
  { value: "openai/gpt-image-1.5", label: "OpenAI — gpt-image-1.5" },
  {
    value: "google/gemini-3-pro-image-preview",
    label: "Google — gemini-3-pro-image-preview",
  },
];
const MODEL_VALUES = new Set(MODEL_OPTIONS.map((option) => option.value));

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

const buildProcessedImage = async (
  file: File,
  id: string
): Promise<ProcessedImageWithBlob> => {
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
    id,
    blob,
    previewUrl,
    width: targetWidth,
    height: targetHeight,
    ratioLabel: target.label,
    ratioValue: target.value,
    name: `${baseName}-cropped.jpg`,
  };
};

const createUploadId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const inferProviderFromModel = (modelId: string): ProviderName => {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("google/")) return "google";
  if (normalized.startsWith("openai/")) return "openai";
  if (normalized.startsWith("gemini-")) return "google";
  return "openai";
};

const dataUrlToBlob = (dataUrl: string) => {
  const [header, payload] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(payload || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { blob: new Blob([bytes], { type: mime }), mime };
};

const extensionForMediaType = (mediaType: string) => {
  const normalized = mediaType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  return "png";
};

const normalizeModelSelection = (value?: string) => {
  if (!value) return DEFAULT_MODEL;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "gpt-image-1.5" || lower === "openai/gpt-image-1.5") {
    return "openai/gpt-image-1.5";
  }
  if (
    lower === "gemini-3-pro-image-preview" ||
    lower === "google/gemini-3-pro-image-preview"
  ) {
    return "google/gemini-3-pro-image-preview";
  }

  if (MODEL_VALUES.has(trimmed)) return trimmed;
  return DEFAULT_MODEL;
};

const readStoredUploads = () => {
  if (typeof window === "undefined") return [] as UploadMeta[];
  try {
    const raw = window.localStorage.getItem(UPLOADS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) =>
      entry && typeof entry.id === "string" && typeof entry.ratioValue === "number"
    );
  } catch {
    return [] as UploadMeta[];
  }
};

const readStoredSettings = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      imageModel: normalizeModelSelection(
        typeof parsed.imageModel === "string" ? parsed.imageModel : DEFAULT_MODEL
      ),
      openaiApiKey:
        typeof parsed.openaiApiKey === "string" ? parsed.openaiApiKey : "",
      googleApiKey:
        typeof parsed.googleApiKey === "string" ? parsed.googleApiKey : "",
    };
  } catch {
    return null;
  }
};

const readStoredSelectedId = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_STORAGE_KEY);
  } catch {
    return null;
  }
};

const readFreeGenerationUsed = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FREE_GENERATION_KEY) === "true";
  } catch {
    return false;
  }
};

const writeFreeGenerationUsed = () => {
  try {
    window.localStorage.setItem(FREE_GENERATION_KEY, "true");
  } catch {
    // Ignore persistence errors.
  }
};

const readPendingGenerationIds = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_GENERATION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry: unknown): entry is string => typeof entry === "string"
      );
    }
    if (parsed && typeof parsed === "object") {
      const ids = (parsed as { ids?: unknown }).ids;
      if (Array.isArray(ids)) {
        return ids.filter(
          (entry: unknown): entry is string => typeof entry === "string"
        );
      }
    }
    return [];
  } catch {
    return [];
  }
};

const writePendingGeneration = (id: string) => {
  try {
    const current = readPendingGenerationIds();
    if (current.includes(id)) return;
    const next = [...current, id];
    window.localStorage.setItem(
      PENDING_GENERATION_KEY,
      JSON.stringify({ ids: next, at: Date.now() })
    );
  } catch {
    // Ignore persistence errors.
  }
};

const clearPendingGeneration = (id?: string) => {
  try {
    if (!id) {
      window.localStorage.removeItem(PENDING_GENERATION_KEY);
      return;
    }
    const current = readPendingGenerationIds();
    const next = current.filter((entry) => entry !== id);
    if (next.length === 0) {
      window.localStorage.removeItem(PENDING_GENERATION_KEY);
      return;
    }
    window.localStorage.setItem(
      PENDING_GENERATION_KEY,
      JSON.stringify({ ids: next, at: Date.now() })
    );
  } catch {
    // Ignore persistence errors.
  }
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
  const [generationById, setGenerationById] = useState<
    Record<string, GenerationStatus>
  >({});
  const [generationErrorsById, setGenerationErrorsById] = useState<
    Record<string, string | null>
  >({});
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UploadPanel | null>(null);
  const [showProcessingOverlay, setShowProcessingOverlay] = useState(false);
  const [showGenerationOverlay, setShowGenerationOverlay] = useState(false);
  const [frameOpacity, setFrameOpacity] = useState(1);
  const [displayRatio, setDisplayRatio] = useState(DEFAULT_RATIO);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadPanel[]>([]);
  const [presetOverrides, setPresetOverrides] = useState<Record<string, string>>(
    {}
  );
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState<UserSettings>(
    DEFAULT_SETTINGS
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  const hasRestoredRef = useRef(false);
  const uploadsRef = useRef<UploadPanel[]>([]);
  const rehydrateInFlightRef = useRef<Set<string>>(new Set());
  const processingTimerRef = useRef<number | null>(null);
  const generationTimerRef = useRef<number | null>(null);
  const frameFadeTimerRef = useRef<number | null>(null);
  const lastFitRef = useRef<{
    width: number;
    height: number;
    maxWidth: number;
  } | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const pending = readPendingGenerationIds();
    if (!pending.length) return;
    setPendingNotice(
      "A previous generation was interrupted. Tap Generate to try again."
    );
    clearPendingGeneration();
  }, []);

  useEffect(() => {
    if (processingTimerRef.current) {
      window.clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }

    if (isProcessing) {
      processingTimerRef.current = window.setTimeout(() => {
        setShowProcessingOverlay(true);
      }, 160);
    } else {
      setShowProcessingOverlay(false);
    }

    return () => {
      if (processingTimerRef.current) {
        window.clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    };
  }, [isProcessing]);

  useEffect(() => {
    if (generationTimerRef.current) {
      window.clearTimeout(generationTimerRef.current);
      generationTimerRef.current = null;
    }

    if (status === "loading") {
      generationTimerRef.current = window.setTimeout(() => {
        setShowGenerationOverlay(true);
      }, 200);
    } else {
      setShowGenerationOverlay(false);
    }

    return () => {
      if (generationTimerRef.current) {
        window.clearTimeout(generationTimerRef.current);
        generationTimerRef.current = null;
      }
    };
  }, [status]);


  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const storedSettings = readStoredSettings();
    if (storedSettings) {
      setSettings(storedSettings);
      setDraftSettings(storedSettings);
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const hydrateUploads = async () => {
      const stored = readStoredUploads();
      if (!stored.length) {
        setIsHydrated(true);
        return;
      }

      const hydrated: UploadPanel[] = [];
      for (const meta of stored) {
        try {
          const record = await getImageRecord(meta.id);
          if (!record?.original) {
            continue;
          }
          const originalUrl = URL.createObjectURL(record.original);
          const generatedUrl = record.generated
            ? URL.createObjectURL(record.generated)
            : undefined;

          hydrated.push({
            ...meta,
            hasGenerated: Boolean(record.generated),
            originalUrl,
            generatedUrl,
          });
        } catch {
          // Skip entries that can't be restored.
        }
      }

      if (isCancelled) return;
      setUploads(hydrated);
      try {
        window.localStorage.setItem(
          UPLOADS_STORAGE_KEY,
          JSON.stringify(
            hydrated.map(({ originalUrl, generatedUrl, ...meta }) => meta)
          )
        );
      } catch {
        // Ignore storage write errors.
      }
      setIsHydrated(true);
    };

    hydrateUploads();

    return () => {
      isCancelled = true;
    };
  }, []);


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

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((item) => {
        if (item.originalUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.originalUrl);
        }
        if (item.generatedUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.generatedUrl);
        }
      });
    };
  }, []);

  const ratioValue = displayRatio;
  const placeholder = useMemo(() => createPlaceholder(ratioValue), [ratioValue]);
  const fitMetrics = useMemo(() => {
    if (!frameSize.width || !frameSize.height) {
      return (
        lastFitRef.current ?? { width: 0, height: 0, maxWidth: 0 }
      );
    }

    const maxRatio = Math.max(MAX_RATIO, ratioValue);
    const fitHeight = Math.min(frameSize.height, frameSize.width / maxRatio);
    const fitWidth = fitHeight * ratioValue;
    const maxWidth = fitHeight * MAX_RATIO;

    const next = {
      width: Math.round(fitWidth),
      height: Math.round(fitHeight),
      maxWidth: Math.round(maxWidth),
    };
    lastFitRef.current = next;
    return next;
  }, [frameSize, ratioValue]);

  const frameOuterStyle = useMemo<CSSProperties>(
    () => ({
      width: fitMetrics.maxWidth,
      height: fitMetrics.height,
      transition: "width 260ms ease, height 260ms ease",
      willChange: "width, height",
    }),
    [fitMetrics.height, fitMetrics.maxWidth]
  );

  const frameMotionStyle = useMemo<CSSProperties>(
    () => ({
      width: fitMetrics.width,
      height: fitMetrics.height,
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      opacity: fitMetrics.height ? frameOpacity : 0,
      transition: "width 260ms ease, opacity 180ms ease",
      willChange: "width, opacity",
    }),
    [fitMetrics.width, fitMetrics.height, frameOpacity]
  );

  useEffect(() => {
    if (frameFadeTimerRef.current) {
      window.clearTimeout(frameFadeTimerRef.current);
      frameFadeTimerRef.current = null;
    }

    if (stage === "upload") {
      setFrameOpacity(1);
      return;
    }

    setFrameOpacity(0.92);
    frameFadeTimerRef.current = window.setTimeout(() => {
      setFrameOpacity(1);
    }, 100);

    return () => {
      if (frameFadeTimerRef.current) {
        window.clearTimeout(frameFadeTimerRef.current);
        frameFadeTimerRef.current = null;
      }
    };
  }, [ratioValue, selectedId, stage]);

  const persistSelectedId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(SELECTED_STORAGE_KEY, id);
    } catch {
      // Ignore persistence errors.
    }
  }, []);

  const persistUploads = useCallback((items: UploadPanel[]) => {
    try {
      window.localStorage.setItem(
        UPLOADS_STORAGE_KEY,
        JSON.stringify(items.map(({ originalUrl, generatedUrl, ...meta }) => meta))
      );
    } catch {
      // Ignore persistence errors.
    }
  }, []);

  const updateUploads = useCallback(
    (updater: (prev: UploadPanel[]) => UploadPanel[]) => {
      setUploads((prev) => {
        const next = updater(prev);
        const prevMap = new Map(prev.map((item) => [item.id, item]));
        const nextMap = new Map(next.map((item) => [item.id, item]));

        for (const [id, prevItem] of prevMap.entries()) {
          const nextItem = nextMap.get(id);
          if (!nextItem) {
            if (prevItem.originalUrl?.startsWith("blob:")) {
              URL.revokeObjectURL(prevItem.originalUrl);
            }
            if (prevItem.generatedUrl?.startsWith("blob:")) {
              URL.revokeObjectURL(prevItem.generatedUrl);
            }
            continue;
          }

          if (
            prevItem.originalUrl &&
            prevItem.originalUrl !== nextItem.originalUrl &&
            prevItem.originalUrl.startsWith("blob:")
          ) {
            URL.revokeObjectURL(prevItem.originalUrl);
          }

          if (
            prevItem.generatedUrl &&
            prevItem.generatedUrl !== nextItem.generatedUrl &&
            prevItem.generatedUrl.startsWith("blob:")
          ) {
            URL.revokeObjectURL(prevItem.generatedUrl);
          }
        }

        persistUploads(next);
        return next;
      });
    },
    [persistUploads]
  );

  const updateGenerationState = useCallback(
    (id: string, nextStatus: GenerationStatus, error: string | null = null) => {
      setGenerationById((prev) => ({ ...prev, [id]: nextStatus }));
      setGenerationErrorsById((prev) => ({ ...prev, [id]: error }));
      if (selectedIdRef.current === id) {
        setStatus(nextStatus);
        setGenerationError(error);
      }
    },
    []
  );

  const rehydrateUploadFromStore = useCallback(
    async (id: string) => {
      if (rehydrateInFlightRef.current.has(id)) return;
      rehydrateInFlightRef.current.add(id);

      try {
        const target = uploadsRef.current.find((entry) => entry.id === id);
        if (!target) return;

        const record = await getImageRecord(id);
        if (!record?.original) {
          updateUploads((prev) => prev.filter((entry) => entry.id !== id));
          if (selectedIdRef.current === id) {
            selectedIdRef.current = CUSTOM_ID;
            setSelectedId(CUSTOM_ID);
            persistSelectedId(CUSTOM_ID);
            setDisplayRatio(DEFAULT_RATIO);
            setStage("upload");
            setProcessed(null);
            setGeneratedSrc(null);
            setBlobUrl(null);
            updateGenerationState(CUSTOM_ID, "idle", null);
          }
          return;
        }

        const originalUrl = URL.createObjectURL(record.original);
        const generatedUrl = record.generated
          ? URL.createObjectURL(record.generated)
          : undefined;

        updateUploads((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  originalUrl,
                  generatedUrl,
                  hasGenerated: Boolean(record.generated),
                }
              : entry
          )
        );

      if (selectedIdRef.current === id) {
        setProcessed({
          id,
          blob: record.original,
          previewUrl: originalUrl,
          width: 0,
          height: 0,
          ratioLabel: target.ratioLabel,
          ratioValue: target.ratioValue,
          name: target.name,
        });
        setDisplayRatio(target.ratioValue);
        setGeneratedSrc(generatedUrl ?? null);
          const nextStatus =
            generationById[id] ??
            (generatedUrl ? "ready" : "idle");
          updateGenerationState(
            id,
            nextStatus,
            generationErrorsById[id] ?? null
          );
          setStage(nextStatus === "idle" ? "preview" : "result");
        }
      } finally {
        rehydrateInFlightRef.current.delete(id);
      }
    },
    [
      generationById,
      generationErrorsById,
      persistSelectedId,
      updateGenerationState,
      updateUploads,
    ]
  );

  const handleSelectedImageError = useCallback(() => {
    const id = processed?.id;
    if (!id) return;
    if (!uploadsRef.current.some((entry) => entry.id === id)) return;
    void rehydrateUploadFromStore(id);
  }, [processed?.id, rehydrateUploadFromStore]);

  const updateScrollState = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;

    if (isDesktop) {
      const maxScroll = strip.scrollHeight - strip.clientHeight;
      setCanScrollPrev(strip.scrollTop > 4);
      setCanScrollNext(strip.scrollTop < maxScroll - 4);
    } else {
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      setCanScrollPrev(strip.scrollLeft > 4);
      setCanScrollNext(strip.scrollLeft < maxScroll - 4);
    }
  }, [isDesktop]);

  useEffect(() => {
    updateScrollState();
  }, [updateScrollState, uploads, selectedId]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const handleScroll = () => updateScrollState();
    strip.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateScrollState);

    return () => {
      strip.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState]);

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

    return response.blob();
  }, []);

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openSettings = useCallback(() => {
    setDraftSettings({
      ...settings,
      imageModel: normalizeModelSelection(settings.imageModel),
    });
    setSettingsNotice(null);
    setIsSettingsOpen(true);
  }, [settings]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    setSettingsNotice(null);
  }, []);

  const saveSettings = useCallback(() => {
    const sanitized = {
      ...draftSettings,
      imageModel: normalizeModelSelection(draftSettings.imageModel),
    };
    setSettings(sanitized);
    setDraftSettings(sanitized);
    setSettingsNotice(null);
    setIsSettingsOpen(false);
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(sanitized)
      );
    } catch {
      // Ignore persistence errors.
    }
  }, [draftSettings]);

  const selectPreset = useCallback(
    (sample: SampleSet) => {
      selectionRef.current += 1;
      selectedIdRef.current = sample.id;
      setSelectedId(sample.id);
      setDisplayRatio(sample.ratioValue);
      persistSelectedId(sample.id);
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
      });
      setGeneratedSrc(presetOverrides[sample.id] ?? sample.generatedSrc);
      setBlobUrl(null);
      const nextStatus = generationById[sample.id] ?? "ready";
      updateGenerationState(
        sample.id,
        nextStatus,
        generationErrorsById[sample.id] ?? null
      );
      setUploadError(null);
      setIsDragging(false);
      preloadSampleBlob(sample);
    },
    [
      generationById,
      generationErrorsById,
      persistSelectedId,
      preloadSampleBlob,
      presetOverrides,
      updateGenerationState,
    ]
  );

  const selectUpload = useCallback(
    async (id: string) => {
      const target = uploads.find((entry) => entry.id === id);
      if (!target) return;

      selectionRef.current += 1;
      const token = selectionRef.current;
      selectedIdRef.current = id;
      setSelectedId(id);
      persistSelectedId(id);
      setUploadError(null);
      setIsDragging(false);
      setBlobUrl(null);
      setIsProcessing(true);

      try {
        const record = await getImageRecord(id);
        if (selectionRef.current !== token) return;
        if (!record?.original) {
          updateUploads((prev) => prev.filter((entry) => entry.id !== id));
          selectedIdRef.current = CUSTOM_ID;
          setSelectedId(CUSTOM_ID);
          setDisplayRatio(DEFAULT_RATIO);
          setStage("upload");
          setProcessed(null);
          setGeneratedSrc(null);
          setBlobUrl(null);
          return;
        }

        let originalUrl = target.originalUrl;
        if (!originalUrl) {
          originalUrl = URL.createObjectURL(record.original);
        }

        let generatedUrl = target.generatedUrl;
        if (record.generated && !generatedUrl) {
          generatedUrl = URL.createObjectURL(record.generated);
        }

        setDisplayRatio(target.ratioValue);
        if (
          originalUrl !== target.originalUrl ||
          generatedUrl !== target.generatedUrl ||
          target.hasGenerated !== Boolean(record.generated)
        ) {
          updateUploads((prev) =>
            prev.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    hasGenerated: Boolean(record.generated),
                    originalUrl,
                    generatedUrl,
                  }
                : entry
            )
          );
        }

        setProcessed({
          id,
          blob: record.original,
          previewUrl: originalUrl,
          width: 0,
          height: 0,
          ratioLabel: target.ratioLabel,
          ratioValue: target.ratioValue,
          name: target.name,
        });
        setGeneratedSrc(generatedUrl ?? null);
        const nextStatus =
          generationById[id] ?? (generatedUrl ? "ready" : "idle");
        updateGenerationState(
          id,
          nextStatus,
          generationErrorsById[id] ?? null
        );
        setStage(nextStatus === "idle" ? "preview" : "result");
      } catch {
        setUploadError("We couldn't load that photo.");
      } finally {
        if (selectionRef.current === token) {
          setIsProcessing(false);
        }
      }
    },
    [
      generationById,
      generationErrorsById,
      persistSelectedId,
      updateGenerationState,
      updateUploads,
      uploads,
    ]
  );

  const openDeleteModal = useCallback((upload: UploadPanel) => {
    setDeleteTarget(upload);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const deleteId = deleteTarget.id;
    setDeleteTarget(null);
    clearPendingGeneration(deleteId);

    setGenerationById((prev) => {
      const next = { ...prev };
      delete next[deleteId];
      return next;
    });
    setGenerationErrorsById((prev) => {
      const next = { ...prev };
      delete next[deleteId];
      return next;
    });

    try {
      await deleteImageRecord(deleteId);
    } catch {
      // Ignore deletion failures.
    }

    const remainingUploads = uploadsRef.current.filter(
      (entry) => entry.id !== deleteId
    );
    updateUploads((prev) => prev.filter((entry) => entry.id !== deleteId));

    if (selectedIdRef.current === deleteId) {
      if (remainingUploads.length > 0) {
        void selectUpload(remainingUploads[0].id);
      } else {
        selectedIdRef.current = CUSTOM_ID;
        setSelectedId(CUSTOM_ID);
        persistSelectedId(CUSTOM_ID);
        setDisplayRatio(DEFAULT_RATIO);
        setStage("upload");
        setProcessed(null);
        setGeneratedSrc(null);
        setBlobUrl(null);
        updateGenerationState(CUSTOM_ID, "idle", null);
      }
    }
  }, [
    deleteTarget,
    persistSelectedId,
    selectUpload,
    updateGenerationState,
    updateUploads,
  ]);

  useEffect(() => {
    if (!isHydrated || hasRestoredRef.current) return;

    const storedSelected = readStoredSelectedId();
    const sample = storedSelected
      ? SAMPLES.find((entry) => entry.id === storedSelected)
      : null;

    if (sample) {
      hasRestoredRef.current = true;
      selectPreset(sample);
      return;
    }

    const upload = storedSelected
      ? uploads.find((entry) => entry.id === storedSelected)
      : null;

    if (upload) {
      hasRestoredRef.current = true;
      void selectUpload(upload.id);
      return;
    }

    hasRestoredRef.current = true;
    selectedIdRef.current = CUSTOM_ID;
    setSelectedId(CUSTOM_ID);
    setDisplayRatio(DEFAULT_RATIO);
    setStage("upload");
  }, [isHydrated, selectPreset, selectUpload, uploads]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setUploadError("Upload a JPG, PNG, or WebP image.");
        return;
      }

      if (file.size > 12 * 1024 * 1024) {
        setUploadError("Please choose an image under 12MB.");
        return;
      }

      setIsProcessing(true);
      setUploadError(null);
      setIsDragging(false);

      try {
        const uploadId = createUploadId();
        const prepared = await buildProcessedImage(file, uploadId);
        try {
          await saveImageRecord({ id: uploadId, original: prepared.blob });
        } catch {
          setUploadError("We couldn't store that photo for later.");
        }

        const now = Date.now();
        const newUpload: UploadPanel = {
          id: uploadId,
          name: prepared.name,
          ratioLabel: prepared.ratioLabel,
          ratioValue: prepared.ratioValue,
          createdAt: now,
          updatedAt: now,
          hasGenerated: false,
          originalUrl: prepared.previewUrl,
        };

        updateUploads((prev) => [newUpload, ...prev]);
        selectedIdRef.current = uploadId;
        setSelectedId(uploadId);
        persistSelectedId(uploadId);
        setDisplayRatio(prepared.ratioValue);
        setProcessed(prepared);
        setGeneratedSrc(null);
        setBlobUrl(null);
        updateGenerationState(uploadId, "idle", null);
        setStage("preview");
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : "We couldn't use that image."
        );
        setStage("upload");
      } finally {
        setIsProcessing(false);
      }
    },
    [persistSelectedId, updateGenerationState, updateUploads]
  );

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

    const activeId = processed.id;
    const modelSelection = normalizeModelSelection(settings.imageModel);
    const provider = inferProviderFromModel(modelSelection);
    const apiKey =
      provider === "google" ? settings.googleApiKey : settings.openaiApiKey;
    const hasUserKey = Boolean(apiKey && apiKey.trim().length > 0);
    const freeUsed = readFreeGenerationUsed();
    if (!hasUserKey && freeUsed) {
      setSettingsNotice(
        `Add your ${provider === "google" ? "Google" : "OpenAI"} API key to generate more images.`
      );
      setIsSettingsOpen(true);
      return;
    }

    if (!hasUserKey && !freeUsed) {
      writeFreeGenerationUsed();
    }

    writePendingGeneration(activeId);
    setPendingNotice(null);

    const fallbackStage: Stage = generatedSrc ? "result" : "preview";
    const fallbackStatus: GenerationStatus = generatedSrc ? "ready" : "idle";

    setStage("result");
    updateGenerationState(activeId, "loading", null);
    setBlobUrl(null);

    const isUpload = uploads.some((entry) => entry.id === activeId);

    try {
      const sourceBlob = await ensureSourceBlob(processed);
      if (isUpload) {
        const activeUpload = uploadsRef.current.find(
          (entry) => entry.id === activeId
        );
        if (!activeUpload?.originalUrl) {
          const originalUrl = URL.createObjectURL(sourceBlob);
          updateUploads((prev) =>
            prev.map((entry) =>
              entry.id === activeId ? { ...entry, originalUrl } : entry
            )
          );
          if (selectedIdRef.current === activeId) {
            setProcessed((prev) =>
              prev
                ? { ...prev, blob: sourceBlob, previewUrl: originalUrl }
                : prev
            );
          }
        }
      }
      const formData = new FormData();
      formData.append("image", sourceBlob, processed.name);
      formData.append("aspectRatio", processed.ratioLabel);
      formData.append("imageModel", modelSelection);
      if (apiKey) {
        formData.append("apiKey", apiKey);
      }

      const response = await fetch("/api/coloring", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429 || data?.code === "KEY_REQUIRED") {
          setSettingsNotice(
            data?.error ||
              `Add your ${provider === "google" ? "Google" : "OpenAI"} API key to continue.`
          );
          setIsSettingsOpen(true);
          updateGenerationState(activeId, fallbackStatus, null);
          if (selectedIdRef.current === activeId) {
            setStage(fallbackStage);
          }
          return;
        }
        throw new Error(data?.error || "Generation failed.");
      }

      const imageData = typeof data?.image === "string" ? data.image : null;
      if (!imageData) {
        throw new Error("No image returned from model.");
      }

      const isActive = selectedIdRef.current === activeId;

      if (isUpload) {
        const { blob: generatedBlob } = dataUrlToBlob(imageData);
        const generatedUrl = URL.createObjectURL(generatedBlob);

        if (isActive) {
          setGeneratedSrc(generatedUrl);
          setBlobUrl(typeof data?.blobUrl === "string" ? data.blobUrl : null);
        }

        updateGenerationState(activeId, "ready", null);

        try {
          await saveImageRecord({
            id: activeId,
            original: sourceBlob,
            generated: generatedBlob,
          });
        } catch {
          // Ignore persistence errors for generated output.
        }

        updateUploads((prev) =>
          prev.map((entry) =>
            entry.id === activeId
              ? {
                  ...entry,
                  hasGenerated: true,
                  updatedAt: Date.now(),
                  generatedUrl,
                }
              : entry
          )
        );
      } else {
        if (isActive) {
          setGeneratedSrc(imageData);
        }
        updateGenerationState(activeId, "ready", null);
        setPresetOverrides((prev) => ({ ...prev, [activeId]: imageData }));
      }
    } catch (error) {
      updateGenerationState(
        activeId,
        "error",
        error instanceof Error ? error.message : "Generation failed."
      );
    } finally {
      clearPendingGeneration(activeId);
    }
  }, [
    ensureSourceBlob,
    generatedSrc,
    processed,
    settings,
    updateGenerationState,
    updateUploads,
    uploads,
  ]);

  const handleDownload = useCallback(async () => {
    if (!generatedSrc && !blobUrl) return;

    const source = blobUrl ?? generatedSrc;
    if (!source) return;

    try {
      let blob: Blob;
      if (source.startsWith("data:")) {
        blob = dataUrlToBlob(source).blob;
      } else {
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error("Download failed.");
        }
        blob = await response.blob();
      }

      const extension = extensionForMediaType(blob.type || "image/png");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `coloring-book.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error("Download failed:", downloadError);
    }
  }, [blobUrl, generatedSrc]);

  const canDownload = status === "ready" && Boolean(generatedSrc || blobUrl);

  const scrollStrip = useCallback(
    (direction: "prev" | "next") => {
      const strip = stripRef.current;
      if (!strip) return;
      const amount = isDesktop ? strip.clientHeight * 0.7 : strip.clientWidth * 0.7;
      if (isDesktop) {
        strip.scrollBy({
          top: direction === "next" ? amount : -amount,
          behavior: "smooth",
        });
      } else {
        strip.scrollBy({
          left: direction === "next" ? amount : -amount,
          behavior: "smooth",
        });
      }
    },
    [isDesktop]
  );

  const overlay =
    status === "loading" && showGenerationOverlay ? (
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

  const processingOverlay = showProcessingOverlay ? (
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
          Etch
        </p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-neutral-900 sm:text-5xl md:text-6xl">
          Turn photos into pencil-ready pages.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-neutral-600 sm:text-base">
          Drop a photo and get clean line art fast, then drag to compare.
        </p>
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={openSettings}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-900/10 bg-white/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-neutral-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            API & Model
          </button>
        </div>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[10rem_minmax(0,1fr)_10rem] lg:items-center">
        <div className="flex w-full justify-center lg:col-start-1 lg:self-center">
          <div className="relative w-full max-w-[520px] lg:max-w-none">
            {canScrollPrev ? (
              <button
                type="button"
                onClick={() => scrollStrip("prev")}
                aria-label={isDesktop ? "Scroll up" : "Scroll left"}
                className={`absolute z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/90 text-neutral-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${
                  isDesktop
                    ? "-top-3 left-1/2 -translate-x-1/2"
                    : "left-1 top-1/2 -translate-y-1/2"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 ${isDesktop ? "-rotate-90" : "-rotate-180"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}
            {canScrollNext ? (
              <button
                type="button"
                onClick={() => scrollStrip("next")}
                aria-label={isDesktop ? "Scroll down" : "Scroll right"}
                className={`absolute z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/90 text-neutral-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${
                  isDesktop
                    ? "-bottom-3 left-1/2 -translate-x-1/2"
                    : "right-1 top-1/2 -translate-y-1/2"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 ${isDesktop ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}

            <div
              ref={stripRef}
              className="flex w-full gap-3 overflow-x-auto pb-2 pt-1 lg:max-h-[clamp(300px,56vh,720px)] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0"
            >
              <button
                type="button"
                onClick={openPicker}
                aria-label="Upload your own photo"
                className={`group relative aspect-[3/2] w-20 flex-shrink-0 overflow-hidden rounded-2xl border-2 border-dashed shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-24 lg:w-full ${
                  selectedId === CUSTOM_ID
                    ? "border-amber-300/80 bg-amber-50/70 shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
                    : "border-neutral-200/80 bg-white/80"
                }`}
              >
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-neutral-600">
                  +
                </div>
                {selectedId === CUSTOM_ID ? (
                  <span className="pointer-events-none absolute inset-0 rounded-2xl border border-amber-400/70" />
                ) : null}
              </button>

              {uploads.map((upload) => {
                const isActive = selectedId === upload.id;
                const hasGenerated = Boolean(upload.generatedUrl);
                const isGenerating = generationById[upload.id] === "loading";
                return (
                  <button
                    key={upload.id}
                    type="button"
                    onClick={() => selectUpload(upload.id)}
                    aria-label={`Use upload ${upload.name}`}
                    className={`group relative aspect-[3/2] w-20 flex-shrink-0 overflow-hidden rounded-2xl border border-white/70 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-24 lg:w-full ${
                      isActive
                        ? "shadow-[0_14px_32px_rgba(15,23,42,0.18)]"
                        : "shadow-sm"
                    }`}
                  >
                    {upload.originalUrl ? (
                      <img
                        src={upload.originalUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        onError={() => void rehydrateUploadFromStore(upload.id)}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-white/70" />
                    )}
                    {hasGenerated && upload.generatedUrl ? (
                      <img
                        src={upload.generatedUrl}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        style={{ clipPath: "inset(0 0 0 50%)" }}
                        onError={() => void rehydrateUploadFromStore(upload.id)}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    {isGenerating ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-sm">
                        <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400/80 border-t-transparent" />
                      </div>
                    ) : null}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        openDeleteModal(upload);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          openDeleteModal(upload);
                        }
                      }}
                      aria-label={`Delete ${upload.name}`}
                      className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/90 text-neutral-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${
                        isActive
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 14h10l1-14" />
                      </svg>
                    </span>
                    {isActive ? (
                      <span className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-amber-400/80" />
                    ) : null}
                  </button>
                );
              })}

              {SAMPLES.map((sample) => {
                const isActive = selectedId === sample.id;
                const generatedSrc =
                  presetOverrides[sample.id] ?? sample.generatedSrc;
                const isGenerating = generationById[sample.id] === "loading";
                return (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => selectPreset(sample)}
                    aria-label={`Use sample ${sample.name}`}
                    className={`group relative aspect-[3/2] w-20 flex-shrink-0 overflow-hidden rounded-2xl border border-white/70 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-24 lg:w-full ${
                      isActive
                        ? "shadow-[0_14px_32px_rgba(15,23,42,0.18)]"
                        : "shadow-sm"
                    }`}
                  >
                    <img
                      src={generatedSrc}
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
                    {isGenerating ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-sm">
                        <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400/80 border-t-transparent" />
                      </div>
                    ) : null}
                    {isActive ? (
                      <span className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-amber-400/80" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 lg:col-start-2">
          <div
            ref={frameRef}
            className="relative flex h-[clamp(300px,56vh,720px)] items-center justify-center"
          >
            <div
              className="relative"
              style={frameOuterStyle}
            >
              {stage === "upload" ? (
                <div
                  className={`relative flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition ${
                    isDragging
                      ? "border-amber-300/80 bg-amber-50/70"
                      : "border-neutral-200/80 bg-white/80"
                  }`}
                  style={frameMotionStyle}
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
                  style={frameMotionStyle}
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
                <div style={frameMotionStyle}>
                  <GSAPImageCompareSliderDemo
                    className="relative"
                    beforeSrc={processed?.previewUrl ?? placeholder}
                    afterSrc={generatedSrc ?? placeholder}
                    aspectRatio={ratioValue}
                    fill
                    overlay={overlay}
                    onBeforeError={handleSelectedImageError}
                    onAfterError={handleSelectedImageError}
                  />
                </div>
              )}
            </div>
            {processingOverlay}
          </div>
        </div>
        <div className="hidden lg:block" />
      </div>

      {pendingNotice ? (
        <div className="mt-5 flex justify-center">
          <div className="rounded-full border border-amber-200/80 bg-amber-50/70 px-4 py-2 text-xs text-amber-900 shadow-sm">
            {pendingNotice}
          </div>
        </div>
      ) : null}

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

      {isSettingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={closeSettings}
        >
          <div
            className="w-full max-w-xl rounded-3xl bg-white px-6 py-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">
                API Key & Model
              </h2>
              <button
                type="button"
                onClick={closeSettings}
                className="rounded-full border border-neutral-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-600"
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-4 text-left">
              <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">
                Model
                <div className="relative mt-2">
                  <select
                    className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white/90 px-4 py-3 pr-12 text-sm text-neutral-800 shadow-sm transition focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-200/70"
                    value={draftSettings.imageModel}
                    onChange={(event) =>
                      setDraftSettings((prev) => ({
                        ...prev,
                        imageModel: event.target.value,
                      }))
                    }
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400">
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 8l4 4 4-4" />
                    </svg>
                  </div>
                </div>
              </label>
              {settingsNotice ? (
                <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-xs text-amber-900">
                  {settingsNotice}
                </div>
              ) : null}
              <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">
                OpenAI API Key
                <input
                  type="password"
                  value={draftSettings.openaiApiKey}
                  onChange={(event) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      openaiApiKey: event.target.value,
                    }))
                  }
                  placeholder="sk-..."
                  className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 shadow-sm"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">
                Google API Key
                <input
                  type="password"
                  value={draftSettings.googleApiKey}
                  onChange={(event) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      googleApiKey: event.target.value,
                    }))
                  }
                  placeholder="AIza..."
                  className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 shadow-sm"
                />
              </label>
              <p className="text-xs text-neutral-500">
                Keys are stored locally in your browser and never leave this
                device except when calling the selected provider.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeSettings}
                className="rounded-full border border-neutral-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded-full bg-neutral-900 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white shadow-lg"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={closeDeleteModal}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white px-6 py-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">
                Delete photo?
              </h2>
              <button
                type="button"
                onClick={closeDeleteModal}
                className="rounded-full border border-neutral-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-600"
              >
                Close
              </button>
            </div>
            <div className="mt-4 text-sm text-neutral-600">
              This removes <span className="font-semibold">{deleteTarget.name}</span>{" "}
              from your browser. You can always upload it again later.
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteModal}
                className="rounded-full border border-neutral-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="rounded-full bg-neutral-900 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white shadow-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
