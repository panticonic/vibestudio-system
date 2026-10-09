const FALLBACK = "Something went wrong. Please try again.";

/**
 * The text to show a person for a caught value. Takes the message from an
 * Error, a string, or an error-shaped object, drops leading "Error: "-style
 * prefixes that String(error) adds, and falls back to a plain sentence.
 */
export function userFacingError(error: unknown, fallback: string = FALLBACK): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof (error as { message?: unknown } | null)?.message === "string"
          ? (error as { message: string }).message
          : "";
  const message = raw.replace(/^(?:\w*Error:\s*)+/, "").trim();
  return message || fallback;
}
