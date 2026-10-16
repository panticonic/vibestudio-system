import { installClientApi } from "@workspace/client-kit-native/host";
import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { getNativeAppStorage } from "./nativeAppStorage";

it("keeps client-local state in the host's client state", async () => {
  const fake = await createFakeClientHost();
  installClientApi(fake.api);
  const storage = getNativeAppStorage();

  expect(await storage.getItem("theme")).toBeNull();
  await storage.setItem("theme", "dark");
  expect(fake.state.get("theme")).toBe("dark");
  expect(await storage.getItem("theme")).toBe("dark");
  await storage.removeItem("theme");
  expect(await storage.getItem("theme")).toBeNull();
});
