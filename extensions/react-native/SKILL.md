---
name: react-native-build-extension
description: Develop or diagnose the React Native build provider in extensions/react-native and its mobile bootstrap artifact contract.
---

# React Native Build Extension

This extension builds the mobile app artifacts that are served to native hosts.

## Contract

- Build both `android` and `ios` Metro bundles when the workspace app supports
  both platforms.
- Resolve React Native, registry dependencies, and workspace/platform modules
  only from the dependency projection Build V2 passes in `BuildProviderInput`.
  The provider must not look in `process.cwd()`, a checkout root, the root
  lockfile, or the native host's Metro configuration.
- Native-module importer policy lives in the app's `nativeModulePolicy` JSON.
  The build provider reads it from the immutable app source projection; the
  native development host reads the same data.
- Each primary artifact must include `platform: "android" | "ios"`,
  `role: "primary"`, `integrity`, content type, encoding, and URL.
- The server bootstrap manifest must include `rnHostAbi`, app/build identity,
  capabilities, artifact set integrity, and provider identity.
- The provider fails the build when the app manifest's `rnHostAbi` differs
  from `RN_HOST_ABI` (`@vibestudio/shared/buildProvider`) and stamps that
  constant into the build metadata.

## Failure Modes

- Missing platform artifact: the native host refuses to activate that
  platform.
- ABI mismatch: the host stays on the recovery UI and tells the user to
  reinstall or rebuild the shell.
- Integrity mismatch: the native finalize step hashes the decompressed bundle
  bytes and refuses activation.
- Missing provider identity: activation fails, because the app build cannot be
  trusted.

## Verification

- Run focused build-provider and native delivery tests after changing
  manifests or artifacts.
- If the change spans build, transport, and activation, run the repository
  mobile smoke workflow before claiming end-to-end delivery works.
