import { NativeModules } from "react-native";
import { nativeActiveAppBuildKey } from "./nativeAppBuildIdentity";

afterEach(() => {
  delete NativeModules["VibestudioMobileHost"];
});

it("reads the native installation's active bundle identity", () => {
  NativeModules["VibestudioMobileHost"] = {
    activeBundleBuildKey: "mobile-build-2",
  };
  expect(nativeActiveAppBuildKey()).toBe("mobile-build-2");
});

it("reports native bootstrap when no workspace bundle is active", () => {
  NativeModules["VibestudioMobileHost"] = { activeBundleBuildKey: "" };
  expect(nativeActiveAppBuildKey()).toBeNull();
});
