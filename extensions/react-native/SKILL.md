---
name: react-native-build-extension
description: Develop or diagnose the React Native build provider in extensions/react-native and its mobile bootstrap artifact contract.
---

# React Native Build Extension

This extension is the build provider for `react-native` clients (declared under
`runtimeExtensions.react-native` in `meta/vibestudio.yml`). It builds the client
artifacts that are served to the Android and iOS hosts.

## Contract

- Build both `android` and `ios` Metro bundles when the client supports
  both platforms.
- Resolve React Native, registry dependencies, and workspace/platform modules
  only from the dependency projection Build V2 passes in `BuildProviderInput`.
  The provider must not look in `process.cwd()`, a checkout root, the root
  lockfile, or the native host's Metro configuration.
- Native-module access is a host-API concern: a client reaches native modules
  only through the host API its `hostAbi` defines, gated by the capabilities it
  was granted. (The current provider still reads a `nativeModulePolicy` file
  from the client source projection; that mechanism is being replaced.)
- Each primary artifact must include `platform: "android" | "ios"`,
  `role: "primary"`, `integrity`, content type, encoding, and URL.
- The server bootstrap manifest must include the host ABI, client/build
  identity, capabilities, artifact set integrity, and provider identity.
- The provider fails the build when the client's `vibestudio.client.hostAbi`
  differs from the host's `rn-host-6` ABI
  (`CURRENT_HOST_ABI["react-native"]` in
  `@vibestudio/workspace-contracts/clients`) and stamps it into the build
  metadata.

## Failure Modes

- Missing platform artifact: the native host refuses to activate that
  platform.
- ABI mismatch: the host stays on the recovery UI and tells the user to
  reinstall or rebuild the shell.
- Integrity mismatch: the native finalize step hashes the decompressed bundle
  bytes and refuses activation.
- Missing provider identity: activation fails, because the client build cannot be
  trusted.

## Verification

- Run focused build-provider and native delivery tests after changing
  manifests or artifacts.
- If the change spans build, transport, and activation, run the repository
  mobile smoke workflow before claiming end-to-end delivery works.
