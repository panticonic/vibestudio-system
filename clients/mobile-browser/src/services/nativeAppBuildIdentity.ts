import { NativeModules } from "react-native";

interface NativeAppHostIdentity {
  activeBundleBuildKey?: string;
  getConstants?: () => { activeBundleBuildKey?: string };
}

export function nativeActiveAppBuildKey(): string | null {
  const host = NativeModules["VibestudioMobileHost"] as
    | NativeAppHostIdentity
    | undefined;
  const value =
    host?.activeBundleBuildKey ?? host?.getConstants?.().activeBundleBuildKey;
  return typeof value === "string" && value.length > 0 ? value : null;
}
