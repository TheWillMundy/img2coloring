This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## AI Configuration

Create a `.env.local` file to control the image provider and model:

```bash
OPENAI_API_KEY=your_openai_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_studio_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
IMAGE_MODEL=gpt-image-1.5
# Optional override: "openai" or "google"
IMAGE_PROVIDER=openai
# Optional: persist generated images to Vercel Blob
SAVE_TO_BLOB=true
```

Notes:
- `IMAGE_MODEL` defaults to `gpt-image-1.5` if not set.
- For Gemini 3 Pro Image Preview, set `IMAGE_MODEL=gemini-3-pro-image-preview`.
- If `IMAGE_PROVIDER` is not set, the app infers the provider from `IMAGE_MODEL`.
- If `SAVE_TO_BLOB=true`, the API will save generated images to Vercel Blob and return a `blobUrl`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
