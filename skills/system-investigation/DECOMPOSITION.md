# System investigation

This program joins guidance from Client Development, Remote Access, Performance, Local Models, and Server Logs. It answers a caller's scoped diagnostic question and cites observations the caller can inspect. Production profiles, client probes, and remote doctor receipts are acquired by the host using the respective skill's documented API. The program can read only the current caller's model inventory and a bounded server log window. It has no lifecycle or configuration mutations.

| Stage | Judgment in Natlang | Mechanism |
| --- | --- | --- |
| `investigateSystem` | Select the investigation and report actionable supported findings | Typed request and evidence identifiers |
| `comparePerformance` | Draw a conclusion from comparable cold/warm trials and localize the next measurement | Exact run identity, median, and threshold arithmetic in `compare.ts` |
| `traceClient` | Distinguish build, activation, runtime, and observation failures | Actual build/runtime/check identity from Client Development receipt |
| `traceRemote` | Locate the first evidenced boundary that blocks remote readiness | Read-only doctor observations, with skipped phases retained as uncertainty |
| `assessModels` | Interpret fit, progress, and failure evidence for the user's chosen local intent | Original local-model catalogue read |
| `readLogs` | Discriminate current failure from routine, recovered, and unrelated lines | Bounded original query, exact boot cursor and timestamps |

Existing model-readiness and host-log brief programs remain available for their original reports. This program adds an evidence-driven investigation over those same services. A result from one stage cannot change a caller's deployed state or broaden its authority.

`auditClientSurface` adds observational audits from the desktop browser and mobile workspace client guides, Mobile Debug, and the React Native build-provider guide. The typed reports distinguish workspace identity over asynchronous operations, invitation lifecycle, platform and ABI checks, and device-scoped readiness. Its TypeScript helpers select exact artifact and receipt identities. The caller's original host surfaces retain all capability ownership.
