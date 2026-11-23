/**
 * Warm prompt openings, the engine-independent part: what a request's opening is and where its rendered text ends. The
 * managed server (llama/warm.ts) and the in-page engine (browser/warm-openings.ts) both prefill an opening once, save
 * the slot state and restore it later; both key a state by the same opening text (`openingText`), hashed to SHA-256.
 * Pure functions, safe in a page.
 */
/** A request's opening: its system prompt and tools; `text` is what identifies it (hash it for a key). */
export type OpeningParts = {
    system: {
        role: 'system';
        content: string;
    };
    tools: unknown[];
    text: string;
};
/** The opening of a request whose first message is a system prompt of at least 256 characters. */
export declare function openingParts(request: {
    messages: readonly unknown[];
    tools?: readonly unknown[];
}): OpeningParts | undefined;
/**
 * The longest text every conversation with this opening starts with, cut just after a special token so that the rest
 * of any prompt tokenizes on from it.
 */
export declare function sharedPrefix(first: string, second: string): string;
/** The two user messages whose renderings, after the opening, differ from their first character (`sharedPrefix`). */
export declare const OPENING_PROBES: readonly ["⁣A", "⁣B"];
