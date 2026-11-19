---
description: Identify the largest measured phase of a build that ran during profiling.
args:
  times: BuildPhaseTimes
returns: '"bundling" | "validation" | "other" | "tied"'
---
Compare bundlingMs, validationMs and otherMs. Return the phase with the strictly largest value. Use tied when two or more share the largest value.
