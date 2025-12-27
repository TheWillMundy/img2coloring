import { NextResponse } from "next/server";
import { generateImage, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

const PROMPT =
  "Turn this photo into a clean, high-contrast coloring book illustration. Keep the main shapes and contours, remove shading and textures, use bold black outlines, and leave a white background. Maintain the EXACT aspect ratio of the original photo, high-resolution.";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";

type ProviderName = "openai" | "google";

const stripProviderPrefix = (modelId: string) => {
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("openai/")) return trimmed.slice("openai/".length);
  if (lower.startsWith("google/")) return trimmed.slice("google/".length);
  return trimmed;
};

const inferProvider = (
  providerOverride: string | undefined,
  modelId: string
): ProviderName => {
  if (providerOverride === "openai" || providerOverride === "google") {
    return providerOverride;
  }

  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("google/")) return "google";
  if (normalized.startsWith("openai/")) return "openai";

  if (
    normalized.startsWith("gemini-") ||
    normalized.startsWith("imagen-") ||
    normalized.startsWith("google-")
  ) {
    return "google";
  }

  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("dall-e") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  ) {
    return "openai";
  }

  return "openai";
};

const toDataUrl = (base64: string, mediaType: string) => {
  if (base64.startsWith("data:")) return base64;
  return `data:${mediaType};base64,${base64}`;
};

const extensionForMediaType = (mediaType: string) => {
  const normalized = mediaType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/png") return "png";
  return "png";
};

const bufferFromBase64 = (base64: string) => {
  const raw = base64.startsWith("data:") ? base64.split(",")[1] ?? "" : base64;
  return Buffer.from(raw, "base64");
};

export async function POST(req: Request) {
  let imageUrl: string | undefined;
  const providerEnv = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  const rawModel = process.env.IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  const provider = inferProvider(providerEnv, rawModel);
  const modelId = stripProviderPrefix(rawModel);
  const shouldSaveToBlob = process.env.SAVE_TO_BLOB === "true";
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (providerEnv && providerEnv !== "openai" && providerEnv !== "google") {
    return NextResponse.json(
      { error: "Invalid IMAGE_PROVIDER. Use 'openai' or 'google'." },
      { status: 500 }
    );
  }

  if (shouldSaveToBlob && !blobToken) {
    return NextResponse.json(
      { error: "Missing BLOB_READ_WRITE_TOKEN." },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : undefined;
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return NextResponse.json(
      { error: "Missing or invalid imageUrl." },
      { status: 400 }
    );
  }

  const sourceResponse = await fetch(imageUrl, {
    headers: {
      "User-Agent": "img2coloringbook/0.1",
    },
  });
  if (!sourceResponse.ok) {
    return NextResponse.json(
      {
        error: "Failed to fetch source image.",
        status: sourceResponse.status,
        statusText: sourceResponse.statusText,
      },
      { status: 400 }
    );
  }

  const arrayBuffer = await sourceResponse.arrayBuffer();
  const sourceImage = Buffer.from(arrayBuffer);

  const saveToBlob = async (
    base64: string,
    mediaType: string,
    providerName: ProviderName,
    providerModel: string
  ) => {
    if (!shouldSaveToBlob || !blobToken) return null;

    const safeModel = providerModel
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .slice(0, 48);
    const extension = extensionForMediaType(mediaType);
    const filename = `colorings/${providerName}-${safeModel}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension}`;

    const blob = await put(filename, bufferFromBase64(base64), {
      access: "public",
      contentType: mediaType,
      token: blobToken,
    });

    return blob.url;
  };

  try {
    if (provider === "google") {
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        return NextResponse.json(
          { error: "Missing GOOGLE_GENERATIVE_AI_API_KEY." },
          { status: 500 }
        );
      }

      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });

      const normalizedModel = modelId.toLowerCase();
      const isImagenModel = normalizedModel.startsWith("imagen-");
      const isGeminiModel = normalizedModel.startsWith("gemini-");

      if (!isImagenModel && !isGeminiModel) {
        return NextResponse.json(
          {
            error:
              "IMAGE_MODEL must be a Gemini image model (gemini-*) or Imagen model (imagen-*).",
          },
          { status: 400 }
        );
      }

      if (isImagenModel) {
        const { image, images } = await generateImage({
          model: google.image(modelId),
          prompt: PROMPT,
        });

        const base64 = image?.base64 ?? images?.[0]?.base64;
        const mediaType =
          image?.mediaType ?? images?.[0]?.mediaType ?? "image/png";

        if (!base64) {
          return NextResponse.json(
            { error: "No image returned from model." },
            { status: 502 }
          );
        }

        const blobUrl = await saveToBlob(
          base64,
          mediaType,
          "google",
          modelId
        );

        return NextResponse.json({
          image: toDataUrl(base64, mediaType),
          blobUrl,
        });
      }

      const result = await generateText({
        model: google(modelId),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image", image: sourceImage },
            ],
          },
        ],
      });

      const file = result.files?.find((entry) =>
        entry.mediaType?.startsWith("image/")
      );
      const mediaType = file?.mediaType ?? "image/png";
      const base64 =
        (file && "base64" in file
          ? (file as { base64?: string }).base64
          : undefined) ??
        (file?.uint8Array
          ? Buffer.from(file.uint8Array).toString("base64")
          : undefined);

      if (!base64) {
        return NextResponse.json(
          { error: "No image returned from model." },
          { status: 502 }
        );
      }

      const blobUrl = await saveToBlob(base64, mediaType, "google", modelId);

      return NextResponse.json({
        image: toDataUrl(base64, mediaType),
        blobUrl,
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY." },
        { status: 500 }
      );
    }

    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { image, images } = await generateImage({
      model: openai.image(modelId),
      prompt: {
        text: PROMPT,
        images: [sourceImage],
      },
    });

    const base64 = image?.base64 ?? images?.[0]?.base64;
    const mediaType = image?.mediaType ?? images?.[0]?.mediaType ?? "image/png";

    if (!base64) {
      return NextResponse.json(
        { error: "No image returned from model." },
        { status: 502 }
      );
    }

    const blobUrl = await saveToBlob(base64, mediaType, "openai", modelId);

    return NextResponse.json({
      image: toDataUrl(base64, mediaType),
      blobUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed.";
    const isDev = process.env.NODE_ENV !== "production";
    const errorInfo =
      typeof error === "object" && error
        ? (error as {
            cause?: unknown;
            statusCode?: number;
            responseBody?: unknown;
          })
        : undefined;

    console.error("Image generation failed:", error);

    return NextResponse.json(
      {
        error: message,
        statusCode: isDev ? errorInfo?.statusCode : undefined,
        responseBody: isDev
          ? errorInfo?.responseBody
            ? JSON.stringify(errorInfo.responseBody)
            : undefined
          : undefined,
        details: isDev && errorInfo?.cause ? String(errorInfo.cause) : undefined,
      },
      { status: 500 }
    );
  }
}
