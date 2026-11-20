// Production mobile continuity surfaces that can be observed through a retained
// host or an explicitly supplied local test transport and store.
export {
  ClientTrustRevokedError,
  MobileRpcClient,
  isTransientMobileTransportFailure,
} from "./mobileTransport.js";
export {
  reconcileTrackedRuntimeLeases,
  trackedRuntimeLeaseWasLost,
} from "./runtimeLeaseRepair.js";
export {
  loadMobileShellStartupSnapshot,
  saveMobileShellStartupSnapshot,
  type MobileShellStartupSnapshot,
} from "./shellStartupSnapshot.js";
