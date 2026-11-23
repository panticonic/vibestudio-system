import {readFileSync} from "node:fs";
import {it,expect} from "vitest";
import matchesClientDeclaration from "./natlang/reviewClientAdmission/chooseNext/matchesClientDeclaration.js";
import type {ClientSourceReview} from "./natlang/types.js";
function source():ClientSourceReview{return {disposition:"published-contract",observation:{source:"clients/owned",working:{hash:"manifest-hash"},published:{hash:"manifest-hash"},catalog:{source:"clients/owned",effectiveVersion:"different-unit-version",activeBuildKey:null,status:"ready"}}} as ClientSourceReview;}
it("matches exact source identity without equating unit version and manifest hash",()=>{
 const value=source();expect(matchesClientDeclaration(value)).toBe(true);expect(value.observation.catalog!.effectiveVersion).not.toBe(value.observation.published.hash);
 value.observation.catalog!.source="clients/foreign";expect(matchesClientDeclaration(value)).toBe(false);
 value.observation.catalog=null;expect(matchesClientDeclaration(value)).toBe(false);
});
it("keeps policy natural-language and presents both identity meanings in the callable instructions",()=>{
 const text=readFileSync(new URL("./natlang/reviewClientAdmission/chooseNext.nl",import.meta.url),"utf8");
 expect(text).toContain("returns: ClientDecision");expect(text).toContain("source: ClientSourceReview");expect(text).toContain("host: ClientHostReview");
 expect(text).toContain("effectiveVersion identifies the installed unit version");expect(text).toContain("published.hash identify manifest bytes");expect(text).toContain("never compare effectiveVersion to a manifest hash");
});
