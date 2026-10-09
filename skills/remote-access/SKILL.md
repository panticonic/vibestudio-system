---
name: remote-access
description: Deploy, pair, inspect, repair, update, or remove a Vibestudio Iroh remote server; diagnose endpoint, relay, identity, membership, or device failures.
---

# Remote access

Run `vibestudio remote --help` for current syntax. Remote application traffic
uses one Iroh QUIC stream per RPC request. Hub control and the selected
workspace use separate authenticated endpoint connections; the hub does not
relay application traffic.

## How it works

- A server is a hub that hosts users, devices, and workspace children.
- The hub and each child have a persistent Iroh endpoint secret and Endpoint ID.
- A device keeps one fixed reach for hub control, and asks the hub for a
  workspace's current reach by workspace ID.
- A reach contains only the protocol version, the Endpoint ID, and an ordered
  list of explicit HTTPS relays.
- Pairing links are complete compact-v4 URLs minted by the server. Never build
  a reach or a link yourself, guess a workspace from its display name, or
  expose a pairing secret.
- Production endpoints disable n0 address lookup and implicit public relays.
- The callback relay exists only for OAuth and webhook HTTP callbacks. Never
  route RPC, panels, bundles, or assets through it.

## Common tasks

Use `vibestudio remote deploy local` for this computer or
`remote deploy <user@host>` for another host. Both set up the same systemd user
service and provide `pairing`, `status`, `logs`, `update`, and `remove`
operations. Pair with the complete link, then use `remote select` to switch
workspaces without replacing the device credential.

Use `remote pair-device` to add another device on the same account, and the
root/admin invitation command to add another person. On mobile, Settings →
Devices shows the server-minted link. For a phone attached to a paired desktop,
see [phone setup](../phone-setup/SKILL.md).

## Diagnosis and repair

1. Run `remote doctor` with the configured relay URLs.
2. Check deployment status and the endpoint registration logs.
3. Determine whether hub control, workspace routing, or a child endpoint
   failed.
4. Refresh a stale workspace reach through the hub, which is still
   authenticated.
5. Use `remote rotate-endpoint --workspace <name> --yes` only when an endpoint
   secret is lost or compromised. Clients pinned to the old Endpoint ID will
   need to re-pair.

Falling back to a relay is normal and is not a security downgrade. Record
whether the active path is direct or relayed, and which configured relay was
used. Don't enable public lookup, bring back a retired transport, replace an
endpoint identity, or add an HTTP fallback just to make a connectivity symptom
go away.

Use focused remote-transport tests for changes to codecs, authentication,
cancellation, reconnects, and routing. Run the full mobile composition smoke
test only when native pairing, activation, lifecycle, or panel loading changes.
