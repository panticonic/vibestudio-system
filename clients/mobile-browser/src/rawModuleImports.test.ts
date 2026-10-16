import fs from "node:fs";
import path from "node:path";

/**
 * A client instance has no raw device modules: the host runtime owns them and
 * serves them through `@vibestudio/rn-client-api`. The build blocks these
 * imports; this keeps the sources honest before the build runs.
 */
const BLOCKED = [
  "react-native-keychain",
  "@react-native-firebase/",
  "@notifee/react-native",
  "@react-native-async-storage/async-storage",
  "@react-native-clipboard/clipboard",
  "@vibestudio/mobile-iroh",
];

const clientRoot = path.resolve(__dirname, "..");
const kitRoot = path.resolve(clientRoot, "../../packages/client-kit-native");

function sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|d)\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every module specifier a file imports, requires or re-exports, with whether it is type-only. */
function specifiers(file: string): Array<{ specifier: string; typeOnly: boolean }> {
  const text = fs.readFileSync(file, "utf8");
  const found: Array<{ specifier: string; typeOnly: boolean }> = [];
  const pattern =
    /(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    found.push({
      specifier: (match[2] ?? match[3] ?? match[4])!,
      typeOnly: Boolean(match[1]),
    });
  }
  return found;
}

describe("client sources use only the host API for device modules", () => {
  const files = [
    ...sources(clientRoot),
    ...sources(path.join(kitRoot, "src")).filter((file) => !file.includes(`${path.sep}testing${path.sep}`)),
  ];

  it("finds the sources it audits", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("imports no raw device module", () => {
    const offenders = files.flatMap((file) =>
      specifiers(file)
        .filter(({ specifier }) => BLOCKED.some((blocked) => specifier.startsWith(blocked)))
        .map(({ specifier }) => `${path.relative(clientRoot, file)} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("declares no raw device module as a dependency", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(clientRoot, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const declared = Object.keys(manifest.dependencies).filter((name) =>
      BLOCKED.some((blocked) => name.startsWith(blocked)),
    );
    expect(declared).toEqual([]);
    expect(manifest.dependencies["@vibestudio/rn-client-api"]).toBeDefined();
  });

  it("does not carry the retired native-module policy", () => {
    expect(fs.existsSync(path.join(clientRoot, "native-module-policy.json"))).toBe(false);
  });
});
