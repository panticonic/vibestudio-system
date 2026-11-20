---
description: Classify which layer of a Vibestudio remote setup failed, from `remote doctor` output, status, or logs.
args:
  diagnosis: string
returns: RemoteLayer
readout: decision
---
diagnosis is the text of `vibestudio remote doctor`, `remote status`, or the endpoint registration logs. Lines marked ✗ failed, ✓ passed and ○ were skipped. Choose the layer of the first failure by the first rule that fits:
1. healthy: nothing failed.
2. client-runtime: the Iroh native binding does not load, or a retired transport dependency or environment variable remains.
3. host-sandbox: the host refuses sandbox user namespaces or bubblewrap is missing, so no workspace can start.
4. server-deployment: the server's endpoint secret or systemd unit is missing, malformed, or has the wrong permissions.
5. device-credential: the paired device credential is missing its endpoint secret, or the paired control reach is malformed or identifies a different server.
6. relay-config: the configured relay set is not canonical HTTPS.
7. hub-control: the hub could not be reached over its control endpoint (the Iroh probe failed).
8. workspace-routing: the hub is reachable, but the reach for a named workspace is stale, missing, or does not match the selected workspace ID.
9. child-endpoint: a workspace's child endpoint failed to start or register with the hub.
