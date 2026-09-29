---
name: local-models
description: Inspect local-model readiness, install a one-click local model when requested, and run agent tasks on an installed local model.
---

# Local models

Use the local-models extension for lifecycle and the ordinary agent runtime for
inference. Never request loopback credentials or call a model server directly.

## Inspect availability

From agent eval, inspect the extension's own state:

```ts
const extension = "@workspace-extensions/local-models";
const [status, models] = await Promise.all([
  services.extensions.invoke(extension, "status", []),
  services.extensions.invoke(extension, "listModels", []),
]);
return { status, models };
```

The preferred local model is `local:qwen3.8-27b` on hardware where `listModels`
offers it. `status.fallback.modelRef` is the compact emergency floor, not the
quality default. A model row is usable when `state` is `startable` or `ready`;
`ready` means warm, while `startable` is a healthy downloaded-but-cold state.
Report `downloading`, `starting`, and `error` honestly rather than treating
absence of readiness as a generic failure. Use `getHardwareProfile` only when
selection or performance depends on the machine.

## Install only on user intent

Downloading model weights is a large persistent effect. Do it only when the
user asked to install, download, prepare, or run a model that is not installed.
Complete an offered one-click model's idempotent installation with its exact ref:

```ts
await services.extensions.invoke("@workspace-extensions/local-models", "installModel", [
  "local:qwen3.8-27b",
]);
```

The call waits for transfer and executable validation. A returned job records
the completed transfer; `null` means the current artifact was already present
and its validation succeeded. Installation failures reject the call. `listModels`
and `status` expose progress during installation; raw download jobs started by
other clients remain in progress until their transfer completes. Do not start
parallel duplicate downloads, invent a catalog slug, or remove a successfully
installed model as cleanup.

Before spawning a local-model child, confirm that its exact row is `startable`
or `ready`. A download job is not an executable model: check its progress through
`listModels`, and report a failed or incomplete installation honestly. Do not
delegate to a downloading model and suspend expecting that child to install it.

## Run a task on the local model

Model execution belongs to a real agent turn. For a bounded delegated task,
spawn a normal `pi` subagent with `config.model` set to the exact installed
`local:<slug>` reference. Prefer `mode: "fresh"` when the task and exact paths
are self-contained; the child's durable workspace context still derives from
the parent. Use `mode: "fork"` only when the local child needs the parent's
conversation trajectory. A local child cannot reuse a cloud provider's context
cache, so forking across that model boundary carries input without the cache
savings of a compatible same-model fork. The runtime starts the installed
model's server and injects loopback authentication
at the trusted execution edge.

Continue useful foreground work, then suspend while the child runs. Do not poll
the child. Its terminal delivery proves that the configured local-model agent
completed or failed the task; retain inspection-only results without merging.
If startup fails, inspect the local-model row and bounded server-log tail and
report the concrete failure.
