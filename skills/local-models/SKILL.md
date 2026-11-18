---
name: local-models
description: Inspect local-model readiness, install a one-click local model when requested, and run agent tasks on an installed local model.
---

# Local models

Use the local-models extension to install and manage models, and the normal
agent runtime to run them. Never ask for loopback credentials or call a model
server directly.

## Check availability

From agent eval, load the typed readiness report. Code reads the catalog and
applies the usability rules; a small model only names the kind of failure
behind each `error` row.

```ts
const readiness = await natlang.load("skills/local-models/localModelReadiness.nl");
const report: Readiness = await readiness.collect();
return report;
```

- `models`: one row per local model with its `ref` (`local:<slug>`), `state`,
  whether it is `usable`, a one-line `detail`, and for an `error` row the
  `failure` kind: `download`, `storage`, `memory`, `engine`, or `unknown`.
- `executor`: `local:lfm3-1.7b`, the model natlang programs run on. When it
  is not usable, natlang programs run on the hosted low-tier model, which is
  billed; say so before running many calls.
- `preferred`: the best usable model for agent tasks, or `null`.
- `advice`: what to tell the user, one line each. Installing is only offered;
  it needs the user's request (see below).

The report is built from `listModels`, the read-only discovery operation, which
is safe in a connected website's causal chain. Lifecycle methods remain closed
there because they start profile-scoped processes or change persistent machine
state. Extension invocation rejects when the owning operation fails, and
successful results are decoded with the shared method descriptor
(`@workspace/model-catalog/localModels`), so malformed wire data remains an
error instead of being treated as partial availability. To see the raw rows,
call `services.extensions.invoke("@workspace-extensions/local-models",
"listModels", [])` and decode them the same way.

The preferred local model is `local:qwen3.8-27b`, on hardware where
`listModels` offers it. `local:lfm3-1.7b` is the small LFM3 model that natlang
programs run on; it is offered on every machine. The small LFM2.5 model is an
emergency fallback, not the recommended default. All of them are served by
natlang's llama.cpp fork, a pinned release of
`werg/llama.cpp-neuralese` whose archives the extension verifies by size and
SHA-256 before use. It never installs upstream llama.cpp binaries. A model row is usable when its `state`
is `startable` (downloaded and healthy, but not running) or `ready` (running).
Report `downloading`, `starting`, and `error` as they are; don't lump them
together as a generic failure. Call `getHardwareProfile` only from a trusted
native operation when model choice or performance depends on the machine.

## Install only when the user asks

Model weights are a large, persistent download. Install only when the user
asked to install, download, prepare, or run a model that is not yet installed.
Install an offered one-click model by its ref; the call is idempotent:

```ts
await services.extensions.invoke(
  "@workspace-extensions/local-models",
  "installModel",
  ["local:qwen3.8-27b"],
);
```

The call returns after the download finishes and the executable has been
validated. It returns a job record for a completed download, or `null` if the
current artifact was already present and passed validation. Installation
failures reject the call. During installation, `listModels` and the Local
Models management panel show progress; a download started by another client
stays in progress until its transfer completes. Don't start a duplicate
download, make up a catalog slug, or remove a successfully installed model as
cleanup.

Before spawning a child agent on a local model, confirm that model's row is
`startable` or `ready`. A model that is still downloading cannot run: track its
progress through `listModels` and report a failed or incomplete installation.
Don't delegate to a downloading model and suspend in the hope that the child
will finish installing it.

For a typed workflow that prepares one selected model, use
`skills/local-model-task/prepareLocalModel.nl` with the caller-owned bindings
from `@workspace-skills/local-model-task-fixtures/binding`. The caller assigns
the exact model ref and grants installation separately after the user requests
it. The workflow rechecks inventory after the install and returns a handoff
only when the requested model, tools, and context capacity are ready.

## Run a task on a local model

Models run inside agent turns. For a bounded delegated task, spawn a normal
`pi` subagent with `config.model` set to the installed `local:<slug>` ref.
Prefer `mode: "fresh"` when the task description and paths are
self-contained; the child still gets its workspace context from the parent.
Use `mode: "fork"` only when the child needs the parent's conversation history.
A local model cannot reuse a cloud provider's context cache, so a fork from a
cloud model sends the full history without the cache savings a same-model fork
would get. The runtime starts the model's server and injects loopback
authentication for the child.

The host prepares the selected local model and re-attests its exact live
endpoint and bearer key for each request. `ensureLoaded` and `attestRuntime`
are internal lifecycle and secret-bearing operations: never call them from
agent eval, ask for their results, or copy an endpoint or key into a message,
catalog record, journal, or panel state.

Do any useful work in the meantime, then suspend while the child runs. Don't
poll the child. When it delivers its result, the task has completed or failed
on the local model; keep inspection-only results without merging them. If the
model fails to start, check its row in `listModels` and a bounded server-log
tail, and report the specific failure.
