import type {ClientSourceReview} from "../../types.js";
/** Compare declaration identity; unit version and manifest digest are unrelated. */
export default function matchesClientDeclaration(source:ClientSourceReview):boolean {
 return source.observation.catalog !== null && source.observation.catalog.source === source.observation.source;
}
