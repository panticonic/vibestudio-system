# Remote access: what is natural language and what is crisp

Ported sub-procedure: classifying which layer of a remote setup failed (steps 1-3 of "Diagnosis and repair").

| Part | Form | Why |
| --- | --- | --- |
| Which layer failed, from `remote doctor` output, `remote status`, or endpoint registration logs | own function, `remoteLayer`, `readout: decision` | Nine finite layers. The doctor prints `✓`/`✗`/`○` lines with free-text messages, and the hub-routing and child-endpoint cases arrive as prose from status and logs, so a fixed parse of `doctor` would cover only four of the nine. Scored by exact match. |
| The next check for each layer | `SKILL.md` table | One row per layer: a command or a log. Crisp enough to be a table; the agent runs the command. |
| Running `remote doctor`, `rotate-endpoint`, deploy, pair | stays with the agent | Effects on a server and on identities (`rotate-endpoint` re-pairs every device). |
| Never build a reach or link by hand; relay fallback is not a downgrade | stays in the skill text | Rules, not procedure. |

The cases are captured from `scripts/cli/remote-doctor.mjs`'s own messages where the doctor produces them. Routing and child-endpoint cases are authored from the skill's description of those layers; no captured log of those two failures exists in the repository.
