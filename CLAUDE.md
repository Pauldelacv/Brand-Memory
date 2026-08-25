## Project Overview

**Brand Memory** is an AI-powered brand intelligence platform.

The application allows teams to upload and connect their brand knowledge:

* Brand guidelines
* Logos and visual assets
* PDFs and presentations
* Previous campaigns
* Website content
* Tone-of-voice documentation
* Product information
* Social media content
* Creative references

The system processes this information into a persistent, queryable **Brand Memory**.

AI features must use this memory as context to generate outputs that are consistent with the brand rather than producing generic content.

The core principle is:

> **The AI should understand the brand before creating for the brand.**

---

# Product Vision

Most generative AI tools operate with limited context.

A user asks:

> Create a campaign for our new product.

The AI receives only the current prompt and produces a generic answer.

Brand Memory changes this workflow.

```text
BRAND KNOWLEDGE
      ↓
INGESTION
      ↓
EXTRACTION
      ↓
STRUCTURING
      ↓
EMBEDDINGS
      ↓
BRAND MEMORY
      ↓
RETRIEVAL
      ↓
AI GENERATION
```

Before generating an answer, the system retrieves relevant information from the company's Brand Memory.

The result should feel like it was created by someone who already understands:

* The brand's positioning
* Its audience
* Its personality
* Its visual language
* Its tone of voice
* Its previous decisions
* Its products
* Its constraints

---

# Target Users

Primary users:

* Brand Designers
* Art Directors
* Creative Directors
* Marketing teams
* Brand Managers
* Startups without dedicated brand teams
* Creative agencies

The first version should focus on **small teams and creative professionals**.

Do not try to solve enterprise governance in the MVP.

---

# Core User Flow

## 1. Create a Brand

The user creates a workspace for a brand.

Required fields:

* Brand name
* Short description
* Industry

Optional fields:

* Website
* Target audience
* Brand positioning

---

## 2. Upload Brand Knowledge

Users can upload:

* PDF
* Images
* Text documents
* Markdown files
* Presentations

Each uploaded file becomes a `Brand Source`.

Example:

```text
Nike Brand Guidelines.pdf
2025 Campaign Deck.pdf
Tone of Voice.md
Product Strategy.pdf
Website Copy.txt
```

---

## 3. Process Content

Every source passes through an ingestion pipeline.

```text
UPLOAD
  ↓
FILE VALIDATION
  ↓
TEXT EXTRACTION / OCR
  ↓
CONTENT CHUNKING
  ↓
METADATA EXTRACTION
  ↓
EMBEDDING GENERATION
  ↓
VECTOR STORAGE
  ↓
BRAND MEMORY READY
```

The original file must always remain linked to its processed data.

Users should be able to trace generated information back to the original source.

---

# Brand Memory Model

Brand Memory is not simply a collection of documents.

The system should progressively extract structured knowledge.

Example:

```text
BRAND

├── Identity
│   ├── Mission
│   ├── Vision
│   └── Values
│
├── Audience
│   ├── Primary audience
│   ├── Secondary audience
│   └── Behaviors
│
├── Positioning
│   ├── Market
│   ├── Differentiators
│   └── Competitors
│
├── Personality
│   ├── Traits
│   ├── Tone
│   └── Archetypes
│
├── Visual Language
│   ├── Typography
│   ├── Colors
│   ├── Photography
│   └── Art Direction
│
├── Voice
│   ├── Vocabulary
│   ├── Writing style
│   └── Forbidden language
│
├── Products
│
└── Creative History
    ├── Campaigns
    ├── Decisions
    └── References
```

This structured layer should coexist with the vector-based document retrieval system.

Do not rely exclusively on embeddings.

---

# AI Generation

The generation flow must follow this process:

```text
USER PROMPT
      ↓
QUERY UNDERSTANDING
      ↓
RELEVANT MEMORY RETRIEVAL
      ↓
BRAND CONTEXT ASSEMBLY
      ↓
LLM
      ↓
GENERATED RESPONSE
      ↓
SOURCE ATTRIBUTION
```

Example user prompt:

> Create a launch campaign for our new electric bike.

The AI should retrieve relevant information about:

* Target audience
* Existing brand positioning
* Previous campaigns
* Tone of voice
* Visual direction
* Product information

The response should include:

1. Creative concept
2. Strategic rationale
3. Suggested messaging
4. Tone of voice
5. Visual direction
6. References to the Brand Memory used

---

# Explainability

Every AI-generated output should answer:

> **Why did the AI generate this?**

The interface must allow the user to inspect:

* Which sources were retrieved
* Which pieces of information influenced the output
* The confidence or relevance of retrieved information

Example:

```text
Generated campaign direction

Sources used:

[✓] Brand Guidelines 2025
[✓] Summer Campaign 2024
[✓] Tone of Voice
[✓] Product Strategy
```

Clicking a source should open the relevant section.

This is a core product principle.

Do not treat source attribution as an optional feature.

---

# MVP Scope

The MVP must include:

## Authentication

Users can:

* Create an account
* Log in
* Log out

---

## Brands

Users can:

* Create a brand
* Edit brand information
* Delete a brand

---

## Sources

Users can:

* Upload documents
* View processing status
* Delete sources

Statuses:

```text
UPLOADED
PROCESSING
READY
FAILED
```

---

## Brand Memory

The application extracts and displays:

* Brand summary
* Personality
* Tone of voice
* Target audience
* Visual principles
* Core values

Users should be able to edit extracted information.

AI extraction is a suggestion, not absolute truth.

---

## Chat / Generation

Users can ask questions such as:

> What is the personality of this brand?

> How would this brand describe a new product?

> Generate three creative territories for a summer campaign.

Every response should use retrieved brand context.

---

# Suggested Tech Stack

## Frontend

* Next.js
* TypeScript
* React
* Tailwind CSS
* shadcn/ui

## Backend

Start with Next.js server-side capabilities.

Do not introduce unnecessary microservices.

Use separate services only when there is a demonstrated need.

---

## Database

* PostgreSQL
* Supabase

Suggested responsibilities:

```text
PostgreSQL
├── Users
├── Brands
├── Brand Sources
├── Extracted Metadata
├── Conversations
└── Generated Outputs
```

---

## Vector Search

Preferred initial approach:

* PostgreSQL
* pgvector

Do not introduce a separate vector database for the MVP unless there is a clear technical limitation.

Keep the architecture simple.

---

## File Storage

Use:

* Supabase Storage

Store:

* Original documents
* Images
* Extracted file references

Do not store large files directly inside PostgreSQL.

---

## AI

The AI layer should remain provider-agnostic.

Create an abstraction such as:

```ts
interface AIProvider {
  generateEmbedding(input: string): Promise<number[]>;
  generateText(input: GenerationInput): Promise<GenerationOutput>;
}
```

Avoid tightly coupling the application to a single AI provider.

Possible providers:

* Anthropic
* OpenAI
* Google

The provider implementation should be replaceable.

---

# Suggested Architecture

```text
src/

├── app/
│   ├── (auth)/
│   ├── dashboard/
│   │   └── brands/
│   └── api/
│
├── components/
│   ├── brand/
│   ├── sources/
│   ├── memory/
│   └── generation/
│
├── lib/
│   ├── ai/
│   │   ├── providers/
│   │   ├── embeddings.ts
│   │   ├── retrieval.ts
│   │   └── generation.ts
│   │
│   ├── ingestion/
│   │   ├── extract.ts
│   │   ├── chunk.ts
│   │   └── process.ts
│   │
│   └── db/
│
├── types/
│
└── actions/
```

Organize code by domain when the application grows.

Do not create excessively abstract folder structures before they are needed.

---

# Core Database Entities

## Brand

```ts
Brand {
  id
  name
  description
  industry
  website
  createdAt
  updatedAt
}
```

---

## BrandSource

```ts
BrandSource {
  id
  brandId
  filename
  type
  storagePath
  status
  createdAt
}
```

---

## DocumentChunk

```ts
DocumentChunk {
  id
  sourceId
  content
  embedding
  metadata
}
```

---

## BrandMemory

Structured information extracted from sources.

```ts
BrandMemory {
  id
  brandId
  category
  content
  sourceReferences
  confidence
  updatedAt
}
```

Possible categories:

```text
IDENTITY
POSITIONING
AUDIENCE
PERSONALITY
VOICE
VISUAL_LANGUAGE
VALUES
PRODUCT
CREATIVE_HISTORY
```

---

# Retrieval Rules

When processing a user request:

1. Identify the intent.
2. Search structured Brand Memory.
3. Search relevant document chunks.
4. Combine and rank results.
5. Remove duplicate or contradictory information.
6. Build the AI context.
7. Generate the response.
8. Attach source references.

Do not dump every document into the LLM context.

Context must be selective.

---

# Conflict Resolution

Brand sources may contain contradictory information.

Example:

```text
Brand Guidelines 2023:
Tone = Playful

Brand Strategy 2025:
Tone = Confident and restrained
```

The system must not silently merge contradictions.

Prefer newer or explicitly authoritative sources.

Future versions should allow users to define source priority.

For the MVP:

```text
User-edited memory
        ↓
Newest official source
        ↓
Other sources
        ↓
AI inference
```

---

# UI Principles

The product should feel like a serious creative tool.

Avoid:

* Generic AI gradients
* Excessive glowing effects
* ChatGPT clones
* Decorative cards everywhere
* “AI magic” visual clichés

Prefer:

* Strong typography
* Clear information hierarchy
* Dense but readable interfaces
* Editorial layouts
* Visible relationships between information
* Functional motion only

The interface should communicate:

> **Knowledge system for creative teams.**

Not:

> **Another AI chatbot.**

---

# Main Screens

## Dashboard

Displays:

* Brands
* Recent activity
* Recent generations

---

## Brand Overview

Displays:

* Brand summary
* Brand health / completeness
* Latest sources
* Extracted memory

---

## Sources

Displays:

```text
SOURCE
TYPE
STATUS
DATE
PRIORITY
```

Users can inspect and manage uploaded knowledge.

---

## Brand Memory

A navigable knowledge map.

Example:

```text
IDENTITY
POSITIONING
AUDIENCE
PERSONALITY
VOICE
VISUAL LANGUAGE
```

Each section shows:

* Extracted knowledge
* Source references
* Last updated date

---

## Generate

The primary workspace.

Possible modes:

```text
Ask
Create
Explore
Compare
```

---

# Development Rules

## TypeScript

Use strict TypeScript.

Do not use `any` unless there is a strong reason.

Prefer explicit types for:

* API boundaries
* Database models
* AI responses
* Retrieval results

---

## Components

Components should have one clear responsibility.

Do not create massive components mixing:

* Data fetching
* Business logic
* AI logic
* UI rendering

Separate these concerns.

---

## Server vs Client

Default to server components.

Use client components only when necessary for:

* Interactivity
* Local state
* Browser APIs

Do not add `"use client"` by default.

---

## Validation

Validate all external input.

Use schema validation for:

* Forms
* API requests
* AI structured outputs

AI output must never be trusted without validation.

---

# AI Output Rules

Whenever possible, request structured output.

Example:

```ts
type BrandAnalysis = {
  summary: string;
  personality: string[];
  toneOfVoice: string[];
  audience: string[];
  evidence: {
    sourceId: string;
    excerpt: string;
  }[];
};
```

Validate the response before storing it.

Do not directly persist raw AI responses as authoritative Brand Memory.

---

# Error Handling

Failures must be explicit.

Examples:

```text
Document extraction failed.

Embedding generation failed.

Source processing partially completed.
```

Do not silently swallow errors.

Use clear states and user-visible feedback.

---

# Performance

Do not optimize prematurely.

Priorities:

1. Correctness
2. Clear architecture
3. Good UX
4. Performance

Background processing can be introduced when document processing becomes slow.

For the first implementation, simple asynchronous processing is acceptable.

---

# Security

Never expose:

* API keys
* Service role keys
* Internal embeddings
* Other users' brand data

Every database query involving brand data must verify ownership.

Multi-tenancy must be considered from the beginning.

A user must never access another user's Brand Memory by modifying an ID in a URL.

---

# Testing Priorities

Prioritize tests for:

1. Retrieval logic
2. Source ownership
3. Brand isolation
4. Structured AI output validation
5. Conflict resolution

Do not spend the majority of early development time testing static UI components.

---

# Non-Goals for MVP

Do not build:

* Full social media publishing
* Image generation
* A Figma competitor
* Project management
* Complex multi-agent systems
* Autonomous AI workflows
* Enterprise permissions
* Billing

The MVP has one job:

> **Store brand knowledge and use it to produce context-aware AI outputs.**

---

# Definition of Done

A feature is complete when:

* It works end-to-end.
* Input is validated.
* Errors are handled.
* Types are correct.
* The UI explains the current state.
* Data access is secure.
* The implementation is understandable without unnecessary abstraction.

Do not mark a feature complete because the happy path works once.

---

# Decision-Making Principle

When choosing between:

```text
More features
```

and:

```text
A clearer, more reliable Brand Memory
```

Choose the second.

The value of the product is not the number of AI features.

The value is the quality and reliability of the context the AI uses.

**Brand Memory is infrastructure for brand intelligence, not another generic AI interface.**
