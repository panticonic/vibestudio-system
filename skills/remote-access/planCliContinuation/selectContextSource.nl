---
description: Determine the CLI's selected context coordinate before validating it.
args:
  selectors: 'CliContextEvidence["selectors"]'
returns: CliContextChoice
---
Return the first present entry in this order: session, context, ambient, binding, default. If none is present return source default and coordinate null.
