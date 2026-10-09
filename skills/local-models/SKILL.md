---
name: local-models
description: Inspect local-model readiness, install a one-click local model when requested, and run agent tasks on an installed local model.
---

# Local models

Use the local-models extension to install and manage models, and the normal
agent runtime to run them. Never ask for loopback credentials or call a model
server directly.

## Check availability

From agent eval, read the extension's state:

```ts
const extension = "@workspace-extensions/local-models";
const [status, models] = await Promise.all([
  services.extensions.invoke(extension, "status", []),
  services.extensions.invoke(extension, "listModels", []),
]);
return { status, models };
```

The preferred local model is `local:qwen3.8-27b`, on hardware where
`listModels` offers it. `status.fallback.modelRef` is a small emergency
fallback, not the recommended default. A model row is usable when its `state`
is `startable` (downloaded and healthy, but not running) or `ready` (running).
Report `downloading`, `starting`, and `error` as they are; don't lump them
together as a generic failure. Call `getHardwareProfile` only when model choice
or performance depends on the machine.

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
failures reject the call. During installation, `listModels` and `status` show
progress; a download started by another client stays in progress until its
transfer completes. Don't start a duplicate download, make up a catalog slug,
or remove a successfully installed model as cleanup.

Before spawning a child agent on a local model, confirm that model's row is
`startable` or `ready`. A model that is still downloading cannot run: track its
progress through `listModels` and report a failed or incomplete installation.
Don't delegate to a downloading model and suspend in the hope that the child
will finish installing it.

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

Do any useful work in the meantime, then suspend while the child runs. Don't
poll the child. When it delivers its result, the task has completed or failed
on the local model; keep inspection-only results without merging them. If the
model fails to start, check its row in `listModels` and a bounded server-log
tail, and report the specific failure.
