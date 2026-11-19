# Android runtime audit

A mobile diagnosis starts from the caller's assigned Android identifier and
the desired observation. The transport is the installed Mobile Debug
extension, whose native authority checks run for each operation.

- The root reads fresh device state, routes to an independent target check,
  and decides whether the task needs a package observation.
- Target review checks the assigned device against native inventory. No
  other device is visible to the model or accepted for package inspection.
- Runtime review checks installation and process state, then checks whether
  a device image was actually captured. The host's current verify receiver
  derives its rendering flag from process presence. Its device screenshot
  does not establish workspace or panel readiness. The report retains the
  observations and identifies the next evidence needed.
- TypeScript owns the assigned serial and package, validates calls, and
  projects the exact RPC results. The program contains no install, launch,
  reset, shell, pairing, broad log, or screenshot byte capability.
