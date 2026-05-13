# Expo LLM Wiki Lab Specification

## Purpose

Build a single-screen Expo demo that integrates the `Simulator`, the `Live AI Provider`, and the `Wiki Instance` into a single playground experience.

This demo should show how `expo-llm-wiki` acts as agnostic middleware that handles memory extraction, long-term storage, and maintenance behavior regardless of whether intelligence comes from a local simulator, a public LLM API, or a local host provider.

The experience should combine zero-config simulation with a BYO-Key architecture so developers can start instantly and later swap in real providers.

---

## Architecture

### 1. Root App Setup

`App.tsx` should:
- create and initialize an SQLite database using `expo-sqlite`
- instantiate the wiki using `createWiki(db, { llmProvider })`
- support three provider modes: simulated, live API, and local host
- expose provider configuration state in a settings modal
- call `instance.setup()` before rendering the main UI
- wrap children with `WikiProvider`

### 2. Configuration State (The Brain Selector)

The app should maintain a lightweight configuration object with:
- `mode: 'sim' | 'live' | 'local'`
- `baseUrl: string`
- `apiKey?: string`
- `providerName?: string`

There should be a dedicated `BrainSettings` component responsible for switching between the simulator, live API, and local Ollama modes.
This component should:
- own the provider selection UI
- expose `onConfigChange(config)` to the parent
- manage local form state for `mode`, `baseUrl`, and `apiKey`
- make simulation the default zero-config experience

The UI should let users choose how to power the Librarian and retrieval logic:
- **Simulated**: local regex/keyword rules return mock JSON immediately
- **OpenAI/Gemini**: `fetch` to a real API endpoint for production-like behavior
- **Local (Ollama)**: connect to `localhost:11434` or a custom URL for privacy/offline utility

### 3. Main Lab Interface

`LabInterface` should include:
- a settings modal / onramp to choose provider mode and enter `Base URL` + `API Key`
- a live event input for free-form user observations
- a progress indicator or animated "Librarian" bar while a write and extraction happen
- a structured fact list driven by `useMemoryRead('user_1', '')`
- a raw SQLite debug panel that queries `llm_wiki_entries` directly
- a `Run Heal` button to trigger `useWikiMaintenance().runHeal()`
- a `Copy Starter Template` button for exporting starter project code

### 4. Simulator Logic

The simulator should feel authentic and follow the expected provider schema.

Use a local mock provider implementation such as `MockLLMProvider` with a `generateText` method. This wrapper should:
- intercept `generateText` calls when `mode === 'sim'`
- return simulated JSON immediately for the Snack
- forward calls to `${config.baseUrl}/chat/completions` when live or local mode is selected
- pass `systemPrompt` and `userPrompt` through the same shape as a real provider

Example: the simulator should implement something like:

```ts
const simulateLibrarian = (input: string) => {
  const facts: Array<{ fact: string; confidence: string; tags?: string[] }> = [];
  const tasks: Array<any> = [];

  const nameMatch = input.match(/name is (\w+)/i);
  if (nameMatch) {
    facts.push({
      fact: `User's name is ${nameMatch[1]}.`, 
      confidence: 'certain',
      tags: ['identity'],
    });
  }

  if (input.toLowerCase().includes('allergic')) {
    facts.push({
      fact: 'User has a potential allergy.',
      confidence: 'tentative',
      tags: ['health'],
    });
  }

  if (input.toLowerCase().includes('todo') || input.toLowerCase().includes('remind')) {
    tasks.push({ task: input, status: 'pending' });
  }

  return JSON.stringify({ facts, tasks });
};
```

The simulator should return exactly this JSON shape so developers can see how the library expects provider output.

### Healer / Contradiction Resolver

The simulated experience should also include a healer pass for `Run Heal` that inspects current facts and returns correction/update instructions.

Example:

```ts
const simulateHealer = (existingFacts: any[]) => {
  const colors = existingFacts.filter((f) => f.fact.toLowerCase().includes('color'));

  if (colors.length > 1) {
    return {
      updates: [
        { id: colors[0].id, action: 'delete', reason: 'Superseded by more recent preference.' },
        { id: colors[1].id, action: 'update', confidence: 'certain' }
      ]
    };
  }

  return { updates: [] };
};
```

This makes the `Run Heal` flow feel like a real episodic-to-structured lifecycle rather than just a button press.

---

## User Flow

1. The app initializes the SQLite database and wiki instance.
2. The user chooses a provider mode in the settings modal.
3. The user enters an event like `My name is Alex`.
4. The user taps `Write to Wiki`.
5. The app writes an `observation` event and updates memory.
6. Extracted facts surface instantly in the UI via `useMemoryRead`.
7. The user can open the raw SQLite debugger to verify rows in `llm_wiki_entries`.
8. The user may tap `Run Heal` to trigger wiki maintenance.

---

## UI Behavior

### Settings Modal / Onramp

- toggle between `Simulation`, `OpenAI/Gemini`, and `Local (Ollama)` modes
- show `Base URL` and masked `API Key` inputs when live or local mode is selected
- allow the user to save configuration state without requiring a key for simulation
- make it clear that swapping the `llmProvider` object is simple and low-friction

### Live Event Log

- provide a text input for event entries
- show a write button disabled while pending
- show a `Librarian` progress bar or spinner while extraction happens
- use event examples like `I just finished my third cup of coffee`

### Structured Wiki Display

- render `memory.facts` from `useMemoryRead('user_1', '')`
- show each fact with text, confidence, and tags
- show a placeholder when no facts exist

### Raw SQLite Debugger

- query `llm_wiki_entries` directly and display results in a simple `FlatList`
- include columns such as timestamp, event payload, and extracted metadata
- demonstrate that the library uses a queryable SQLite store and is not "magic"

### Footer Tools

- `Run Heal` triggers `useWikiMaintenance().runHeal()` and visibly updates maintenance state
- `Copy Starter Template` copies a pre-configured `App.tsx` template to the clipboard

---

## Provider Modes

### Default Mode

- default should be `mode: 'sim'`
- no API key is required
- the app should work out of the box in an Expo Snack

### Live Provider Mode

- when `mode === 'live'`, use a real API provider
- send requests to `${config.baseUrl}/chat/completions`
- forward the provider response into the wiki
- support `apiKey` as masked input for BYO-Key usage
- use a model like `gpt-4o-mini` or another API-compatible model

### Local Provider Mode

- when `mode === 'local'`, connect to `config.baseUrl` for local host providers
- default local URL can be `http://localhost:11434`
- allow a custom tunnel URL for remote/local development
- demonstrate privacy-first / offline capability

---

## Expected Provider Output Schema

The simulator and provider integration should document the library’s expected JSON schema:

```ts
{
  facts: Array<{
    fact: string;
    confidence: string;
    tags?: string[];
  }>;
  tasks: Array<any>;
}
```

---

## Starter Project Export

The app should include a floating action button or footer button labeled `Copy Starter Template`.

The copied snippet should include:
1. `WikiProvider` setup
2. `createWiki` initialization
3. a `useEffect` hook that calls `wiki.setup()`
4. a minimal example of writing an event and reading memory

This makes the demo feel like a real starter project and helps developers bootstrap a new app.

---

## Recommended Usage

- use this spec to build a Snack-ready hybrid lab for `@equationalapplications/expo-llm-wiki`
- keep the default path zero-config and immediate to discover
- add the BYO-Key settings modal so developers can swap in live or local providers later
- make maintenance and memory transparency tangible with a heal action and raw SQLite debugger
