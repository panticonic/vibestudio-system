import { describe, expect, it } from "vitest";
import { userFacingError } from "./userFacingError";

describe("userFacingError", () => {
  it("reads the message of errors, strings, and error-shaped objects", () => {
    expect(userFacingError(new Error("Nope"))).toBe("Nope");
    expect(userFacingError("Plain")).toBe("Plain");
    expect(userFacingError({ message: "Shaped" })).toBe("Shaped");
  });

  it("strips leading Error prefixes", () => {
    expect(userFacingError("Error: TypeError: Broke")).toBe("Broke");
  });

  it("falls back to a sentence for empty or unknown values", () => {
    expect(userFacingError(undefined)).toMatch(/Something went wrong/);
    expect(userFacingError(new Error(""), "Custom")).toBe("Custom");
  });
});
