# Performance profiling in Natlang

The build workflow starts with one caller-assigned workspace unit and an optional
initial payload budget. It reports what the native profile establishes and
chooses one follow-up measurement. The caller owns the context and any changes
between runs.

| Procedure | Owner |
|---|---|
| Resolve the assigned unit in the caller's context, profile it and verify the repeat with the native build service | TypeScript binding over testkit |
| Preserve the state hash, build keys and separate byte counters | TypeScript projection of the native receipt |
| Interpret first-run cache evidence and judge what the repeat establishes | Natlang build-run assessment |
| Identify the largest measured phase on a build performed during the profile | Natlang phase assessment |
| Compare the panel's initial payload with its budget and choose the largest initial contributor | Natlang payload assessment and contributor selection |
| Choose the next experiment and explain any missing evidence | Natlang follow-up |
| Profile renderer actions, startup, worker isolates and other surfaces | The skill's existing native measurement recipes |

The program does not apply optimizations or compare durations across different
cache states. Each rerun uses a fresh binding. The caller can use the state
hash and build keys to identify what was measured.
