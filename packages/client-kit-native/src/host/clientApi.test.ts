import { createFakeClientHost } from "../testing/fakeClientHost";
import {
  clientApi,
  hasClientCapability,
  installClientApi,
  requireClientCapability,
} from "./clientApi";

describe("client api holder", () => {
  it("serves the installed api and its current grants", async () => {
    const fake = await createFakeClientHost({ granted: ["clipboard"] });
    installClientApi(fake.api);
    expect(clientApi()).toBe(fake.api);
    expect(hasClientCapability("clipboard")).toBe(true);
    expect(hasClientCapability("notifications")).toBe(false);
    expect(() => requireClientCapability("notifications", "push")).toThrow(
      "push requires the granted client capability 'notifications'",
    );

    fake.emit({ type: "capabilities", granted: ["notifications"] });
    expect(() => requireClientCapability("notifications", "push")).not.toThrow();
  });
});
