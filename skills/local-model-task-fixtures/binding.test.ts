import { describe, expect, it } from "vitest";
import { createLocalModelTaskBindings } from "../local-model-task-bindings/index.js";
import { createLocalModelTaskFixture } from "./fixture.js";
import { verifyLocalModelTask } from "./oracle.js";
import { localModelTaskWorlds } from "./worlds.js";

describe("local-model task fixture contract", () => {
  it.each(localModelTaskWorlds)(
    "independently verifies report and extension journal for $id",
    async (world) => {
      const fixture = createLocalModelTaskFixture(world);
      const { localModelTaskInventory, localModelTaskInstall } =
        fixture.bindings;
      const ref = world.request.modelRef;
      const initial = await localModelTaskInventory.inspect(ref);
      expect(initial?.state ?? null).toBe(world.snapshots[0]?.state ?? null);
      if (
        world.expected.receipt ||
        world.expected.disposition === "installation-rejected"
      ) {
        const install = localModelTaskInstall.installOnce(ref);
        if (world.expected.disposition === "installation-rejected") {
          await expect(install).rejects.toThrow();
        } else {
          await expect(install).resolves.toEqual(world.expected.receipt);
          expect(
            (await localModelTaskInventory.inspect(ref))?.state ?? null,
          ).toBe(world.expected.state);
        }
      }
      const journal = fixture.audit();
      expect(verifyLocalModelTask(world, world.expected, journal).passed).toBe(
        true,
      );
      expect(
        verifyLocalModelTask(
          world,
          { ...world.expected, ref: "local:another" },
          journal,
        ).passed,
      ).toBe(false);
      expect(
        verifyLocalModelTask(world, world.expected, [
          ...journal,
          "installModel",
        ]).passed,
      ).toBe(false);
      if (world.expected.receipt) {
        await expect(localModelTaskInstall.installOnce(ref)).rejects.toThrow(
          "already attempted",
        );
        expect(fixture.audit()).toEqual(journal);
      }
    },
  );

  it("rejects mismatched refs without invoking the extension", async () => {
    const ref = "local:assigned";
    const { localModelTaskInstall, localModelTaskInventory } =
      createLocalModelTaskBindings(
        {
          async invoke() {
            throw new Error("Unexpected invocation");
          },
        },
        { modelRef: ref, authorizedInstallRef: ref },
      );
    await expect(
      localModelTaskInstall.installOnce("local:other"),
    ).rejects.toThrow("has not authorized");
    await expect(
      localModelTaskInventory.inspect("local:other"),
    ).rejects.toThrow("Inspect only the assigned local model");
  });
});
