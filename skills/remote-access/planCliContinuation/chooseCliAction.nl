---
description: Select an allowed continuation without changing the command or context.
args:
  status: CliContextStatus
  credential: 'CliContextEvidence["credential"]'
  operation: 'CliContextEvidence["operation"]'
returns: 'CliContinuation["action"]'
---
1. For any status other than usable return repair-scope.
2. For a usable agent credential and an eval or edit request, return ask-parent.
3. For the remaining usable requests return run-assigned-command.
