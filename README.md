# WEBL — AI Video Editing Platform

> **Built for the Mistral AI Hackathon** — Powered by **Mistral Large 3** and **Voxtral** via AWS Bedrock

## Overview

WEBL is an AI-powered video editing platform that automates the entire post-production pipeline. Upload a voiceover, provide B-roll clips, and WEBL uses **Mistral Large 3** to intelligently edit your video — from transcript correction to creative cut planning. The platform replaces hours of manual editing with an automated, AI-driven workflow that understands context, emotion, and narrative flow.

## Key AI Features (Powered by Mistral)

- **Voiceover Transcription** — Voxtral via AWS Bedrock for accurate word-level transcription
- **Transcript Correction** — Mistral Large 3 corrects transcription errors with context awareness
- **Semantic Segmentation** — Mistral Large 3 analyzes voiceover for emotional tone and keywords
- **Creative Edit Planning** — Mistral Large 3 acts as an AI creative director, deciding how to cut B-roll to voiceover
- **Script Alignment** — Mistral Large 3 aligns voiceover with script content
- **Smart Chunk Selection** — Mistral Large 3 selects optimal B-roll for each voiceover segment
- **Script Generation** — Mistral Large 3 generates video scripts from persona and templates

## Architecture Overview

```mermaid
flowchart TB
    subgraph "Client"
        Mobile["📱 Expo Mobile App"]
    end

    subgraph "Backend"
        API["🔌 Express API\nClerk Auth + Socket.IO"]
        Workers["⚙️ BullMQ Workers\n18+ Job Types"]
        Redis["Redis\nQueues + Pub/Sub"]
        DB["PostgreSQL + pgvector\nNeon"]
    end

    subgraph "AI Layer (Mistral-Powered)"
        Bedrock["☁️ AWS Bedrock"]
        ML3["🤖 Mistral Large 3\n675B Parameters\nAll LLM Text Generation"]
        VX["🎙️ Voxtral\nAudio Transcription"]
    end

    subgraph "Media"
        S3["AWS S3\nAsset Storage"]
        Mux["Mux\nVideo Delivery"]
    end

    subgraph "Fallback Providers"
        Gemini["Gemini API"]
        OpenAI["OpenAI\nEmbeddings + Fallback LLM"]
        Deepgram["Deepgram\nFallback Transcription"]
    end

    Mobile --> API
    API --> Redis --> Workers
    API --> DB
    Workers --> DB
    Workers --> Bedrock
    Bedrock --> ML3
    Bedrock --> VX
    Workers --> S3
    Workers --> Mux
    Workers -.->|fallback| Gemini
    Workers -.->|embeddings| OpenAI
    Workers -.->|fallback| Deepgram
```

## AI Provider Architecture

```mermaid
flowchart LR
    ENV["AI_PROVIDER=mistral"] --> Router{"Provider Router"}
    Router -->|"★ mistral (default)"| BM["callBedrockMistralChat()\nConverse API"]
    Router -->|"gemini"| GM["Google Generative AI SDK"]
    Router -->|"openai"| OA["OpenAI SDK"]
    Router -->|"runpod"| RP["Runpod vLLM"]
    BM --> Model["mistral.magistral-small-2509"]
```

## Video Processing Pipeline

```mermaid
flowchart TD
    Upload["📤 Upload Voiceover"] --> P1

    subgraph P1["Phase 1: Voiceover Processing"]
        Ingest["Ingest"] --> Transcribe["Transcribe\n🎙️ Voxtral"]
        Transcribe --> Correct["Correct Transcript\n🤖 Mistral Large 3"]
        Correct --> TakeSelect["Take Selection"]
        TakeSelect --> SilenceDetect["Silence Detection"]
        SilenceDetect --> Clean["Audio Cleaning"]
        Clean --> Segment["Segmentation\n🤖 Mistral Large 3"]
    end

    UploadClips["📤 Upload B-Roll"] --> P2

    subgraph P2["Phase 2: B-Roll Pipeline"]
        BIngest["Ingest Clips"] --> Chunk["Chunk (2s)"]
        Chunk --> Enrich["Enrich Chunks\n🤖 Mistral Large 3"]
        Enrich --> Embed["Generate Embeddings\nOpenAI"]
    end

    P1 & P2 --> P3

    subgraph P3["Phase 3: Semantic Matching"]
        Match["pgvector Similarity Search"] --> Creative["Creative Edit Plan\n🤖 Mistral Large 3"]
    end

    P3 --> P4

    subgraph P4["Phase 4: Cut Planning"]
        CutPlan["Generate Cut Plan\n🤖 Mistral Large 3"] --> Validate["Validate"]
    end

    P4 --> P5

    subgraph P5["Phase 5: Render & Publish"]
        Render["FFmpeg Render"] --> Publish["Mux Publish"]
    end
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **AI (LLM)** | **Mistral Large 3 (675B) via AWS Bedrock** |
| **AI (Transcription)** | **Voxtral via AWS Bedrock** |
| AI (Embeddings) | OpenAI text-embedding-3-large |
| AI (Video Analysis) | Qwen3-VL via Runpod |
| Mobile | Expo v54, React Native, NativeWind, Zustand |
| API | Express, Socket.IO, Clerk Auth |
| Workers | BullMQ, FFmpeg |
| Database | PostgreSQL + pgvector (Neon) |
| Storage | AWS S3 |
| Video CDN | Mux |
| Queue | Redis (Upstash) |

## Monorepo Structure

```
webl-hackathon/
├── apps/
│   ├── api/          # Express REST API + Socket.IO realtime
│   ├── workers/      # BullMQ background jobs (FFmpeg, Mistral, Voxtral)
│   ├── mobile/       # Expo React Native app
│   └── admin/        # Next.js admin panel
├── packages/
│   ├── shared/       # Types, schemas, utilities
│   └── prisma/       # Database schema + migrations
└── templates/        # Video templates + editing recipes
```

## Getting Started

```bash
pnpm install
pnpm build:packages
pnpm dev
```

## Environment Variables

Key AI variables:

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER=mistral` | Sets Mistral as default LLM (options: `mistral`, `gemini`, `openai`, `runpod`) |
| `TRANSCRIPTION_PROVIDER=voxtral` | Sets Voxtral as default transcription provider |
| `AWS_BEDROCK_REGION` | AWS region for Bedrock access |
| `AWS_BEDROCK_MISTRAL_MODEL` | Defaults to `mistral.magistral-small-2509` |
| `AWS_BEDROCK_BEARER_TOKEN` | Bearer token for Bedrock auth (or use IAM credentials) |

## Why Mistral?

- **Mistral Large 3 (675B)** delivers exceptional instruction-following for our multi-step video editing pipeline. Each job in the pipeline requires precise structured output (JSON schemas, timestamps, creative decisions), and Mistral Large 3 handles these reliably.
- **Voxtral** provides high-quality audio transcription with precise word-level timestamps, critical for frame-accurate video editing.
- **AWS Bedrock** gives us enterprise-grade infrastructure with the Converse API for unified model access, eliminating the need to manage inference infrastructure.
- The multi-provider architecture (`llmProvider.ts`) allows seamless fallback to Gemini or OpenAI if needed, but Mistral is the primary and default provider for all LLM tasks.

## License

Private — Hackathon Submission
