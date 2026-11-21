import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import * as fs from "node:fs";
import * as path from "node:path";
import { PANEL_PRINCIPAL_PREFIX } from "@vibestudio/shared/principalIds";
import { WORKSPACE_IMPORT_PARENT_DIRS } from "@vibestudio/workspace-contracts/sourceDirs";
import { typeCheckRpcMethods, type TypeCheckRpcOptions } from "./typecheckService.js";
import { type WorkspaceContext, type WorkspacePackageInfo } from "@vibestudio/typecheck";

interface ExtensionContextLike {
  workspace: {
    getInfo(): Promise<{ path: string; contextProjectionsPath: string }>;
  };
  fs: {
    /** Materialize the given workspace path(s)/repo(s) into the (sparse) context
     *  folder so they can be read from disk. */
    ensureMaterialized(scope: string | string[] | "all"): Promise<string>;
  };
  rpc: {
    call: import("@vibestudio/rpc").RpcCaller["call"];
  };
  invocation: {
    current(): {
      caller: { callerId: string; contextId?: string };
      chainCaller?: { contextId?: string };
    } | null;
  };
  log: {
    info(message: string): void;
  };
}

type CheckPanelOptions = {
  contextId?: string;
};

type BrowserTypeDefinitionsOptions = {
  panelPath?: string;
  packageNames?: string[];
  contextId?: string;
};

function extractPanelSourceFromCallerId(callerId: string): string | undefined {
  const treePrefix = `${PANEL_PRINCIPAL_PREFIX}tree/`;
  if (!callerId.startsWith(treePrefix)) return undefined;
  const afterTree = callerId.slice(treePrefix.length);
  const slashIdx = afterTree.indexOf("/");
  const segment = slashIdx >= 0 ? afterTree.slice(0, slashIdx) : afterTree;
  if (!segment) return undefined;
  return segment.replace(/~/g, "/");
}

function validateContextId(contextId: string): void {
  if (!contextId || contextId.length > 63) {
    throw new Error(`Invalid context ID: length must be 1-63, got ${contextId.length}`);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(contextId)) {
    throw new Error(`Invalid context ID: ${contextId}`);
  }
}

function resolveWithin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes context root: ${relativePath}`);
  }
  return resolved;
}

function resolvePanelPath(root: string, panelPath: string, contextId: string | undefined): string {
  return !contextId && path.isAbsolute(panelPath) ? panelPath : resolveWithin(root, panelPath);
}

function validateFilePath(root: string, filePath: string | undefined, contextId: string | undefined): void {
  if (filePath && (contextId || !path.isAbsolute(filePath))) resolveWithin(root, filePath);
}

async function typecheckRoot(ctx: ExtensionContextLike, contextId: string | undefined): Promise<string> {
  if (!contextId) return (await ctx.workspace.getInfo()).path;
  validateContextId(contextId);
  // Dependency discovery needs the complete participant projection. The
  // materialization receipt identifies its physical location.
  const root = await ctx.fs.ensureMaterialized("all");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch (error) {
    throw new Error(`Materialized context root is unavailable: ${root}`, { cause: error });
  }
  if (!stat.isDirectory()) throw new Error(`Materialized context root is not a directory: ${root}`);
  return root;
}

/**
 * Discover package metadata from one fully materialized semantic context.
 * Unlike the tolerant source-workspace discovery used outside contexts, this
 * is an authority boundary: malformed or duplicate package metadata is an
 * explicit failure, never a reason to borrow a package from live main.
 */
function discoverExactContextWorkspaceContext(contextRoot: string): WorkspaceContext {
  const packages = new Map<string, WorkspacePackageInfo>();
  for (const root of WORKSPACE_IMPORT_PARENT_DIRS) {
    for (const pkgDir of packageDirsUnder(path.join(contextRoot, root))) {
      const packageJsonPath = path.join(pkgDir, "package.json");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
      } catch (error) {
        throw new Error(`Invalid package metadata in semantic context: ${packageJsonPath}`, {
          cause: error,
        });
      }
      const name = parsed["name"];
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error(`Semantic context package has no valid name: ${packageJsonPath}`);
      }
      const existing = packages.get(name);
      if (existing) {
        throw new Error(
          `Semantic context contains duplicate package name ${JSON.stringify(name)}: ` +
            `${existing.dir} and ${pkgDir}`
        );
      }
      packages.set(name, { name, dir: pkgDir, packageJson: parsed });
    }
  }
  return { monorepoRoot: contextRoot, packages };
}

function discoverWorkspaceSourceContext(workspaceRoot: string): WorkspaceContext | null {
  const packages = new Map<string, WorkspacePackageInfo>();
  for (const root of WORKSPACE_IMPORT_PARENT_DIRS) {
    const dir = path.join(workspaceRoot, root);
    for (const pkgDir of packageDirsUnder(dir)) {
      const packageJsonPath = path.join(pkgDir, "package.json");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      const parsedName = parsed["name"];
      const name = typeof parsedName === "string" ? parsedName : "";
      if (!name || packages.has(name)) continue;
      packages.set(name, { name, dir: pkgDir, packageJson: parsed });
    }
  }
  return packages.size > 0 ? { monorepoRoot: workspaceRoot, packages } : null;
}

function packageDirsUnder(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = path.join(root, entry.name);
    if (fs.existsSync(path.join(child, "package.json"))) dirs.push(child);
    if (entry.name.startsWith("@")) dirs.push(...packageDirsUnder(child));
  }
  return dirs;
}

/** Source and dependency discovery share the caller's semantic coordinate.
 * Installation and resource admission belong to the host, never this child. */
async function typecheckOptions(
  ctx: ExtensionContextLike,
  root: string,
  panelPath: string,
  contextId: string | undefined
): Promise<TypeCheckRpcOptions> {
  const workspaceContext = contextId
    ? discoverExactContextWorkspaceContext(root)
    : discoverWorkspaceSourceContext(root);
  const unit = path.relative(root, panelPath).split(path.sep).join("/");
  resolveWithin(root, unit);
  const environment = await ctx.rpc.call("main", mainRpcMethods["build.prepareTypecheck"], [unit, contextId ? `ctx:${contextId}` : undefined]);
  const packages = new Map(workspaceContext?.packages);
  for (const [name, dir] of Object.entries(environment.workspacePackages)) {
    const manifestPath = path.join(dir, "package.json");
    const manifestBytes = fs.readFileSync(manifestPath);
    const packageJson = JSON.parse(manifestBytes.toString("utf8"));
    if (packageJson.name !== name)
      throw new Error(`Compiler package identity mismatch: ${name}`);
    const semantic = packages.get(name);
    if (semantic) {
      const semanticManifest = fs.readFileSync(path.join(semantic.dir, "package.json"));
      if (!semanticManifest.equals(manifestBytes)) {
        throw new Error(`Admitted package does not match the exact semantic manifest: ${name}`);
      }
    }
    packages.set(name, { name, dir, packageJson });
  }
  return { workspaceContext: { monorepoRoot: root, packages }, ...environment };
}

function currentCallerPanelPath(ctx: ExtensionContextLike): string | undefined {
  const callerId = ctx.invocation.current()?.caller.callerId;
  return callerId ? extractPanelSourceFromCallerId(callerId) : undefined;
}

function currentInvocationContextId(ctx: ExtensionContextLike): string | undefined {
  const invocation = ctx.invocation.current();
  return invocation?.chainCaller?.contextId ?? invocation?.caller.contextId;
}

function invocationContextId(ctx: ExtensionContextLike, requested?: string): string | undefined {
  const current = currentInvocationContextId(ctx);
  if (requested !== undefined && requested !== current)
    throw new Error("Typechecking is scoped to the caller's context; invoke from the target context");
  return current;
}

function normalizeCheckPanelOptions(options?: CheckPanelOptions | string): CheckPanelOptions {
  if (options === undefined) return {};
  if (typeof options === "string") return { contextId: options };
  return options;
}

/** Public API surface of this extension — the awaited return of {@link activate}. */
export type Api = Awaited<ReturnType<typeof activate>>;
// Intentionally NOT registered in the WorkspaceExtensions type registry.
// typecheck-service is agent/host infrastructure invoked over the extension RPC,
// not something panels call via extensions.use(...). Registering it would drag
// its type graph — including @vibestudio/typecheck and the ~2.4MB bundled
// TypeScript lib sources — into every panel's type-check program for no benefit.

export async function activate(ctx: ExtensionContextLike) {
  ctx.log.info("typecheck-service activating");
  return {
    async checkPanel(panelPath?: string, options?: CheckPanelOptions | string) {
      const source = panelPath ?? currentCallerPanelPath(ctx);
      if (!source) {
        throw new Error(
          "Could not auto-detect panel path from caller ID. " +
            'Pass the panel source path explicitly, e.g. checkPanel("panels/my-app")'
        );
      }
      const contextId = invocationContextId(ctx, normalizeCheckPanelOptions(options).contextId);
      const root = await typecheckRoot(ctx, contextId);
      const resolvedPath = resolvePanelPath(root, source, contextId);
      const result = await typeCheckRpcMethods["typecheck.check"](
        resolvedPath,
        undefined,
        undefined,
        await typecheckOptions(ctx, root, resolvedPath, contextId)
      );
      return {
        diagnostics: result.diagnostics,
        errorCount: result.diagnostics.filter((d) => d.severity === "error").length,
        warningCount: result.diagnostics.filter((d) => d.severity === "warning").length,
      };
    },

    async check(panelPath?: string, filePath?: string, fileContent?: string, contextId?: string) {
      const source = panelPath ?? currentCallerPanelPath(ctx);
      if (!source) {
        throw new Error(
          "typecheck-service.check: panel path is required and could not be auto-detected from caller. " +
            'Pass the panel source path explicitly, e.g. check("panels/my-app")'
        );
      }
      const effectiveContextId = invocationContextId(ctx, contextId);
      const root = await typecheckRoot(ctx, effectiveContextId);
      const resolvedPanelPath = resolvePanelPath(root, source, effectiveContextId);
      validateFilePath(root, filePath, effectiveContextId);
      return typeCheckRpcMethods["typecheck.check"](
        resolvedPanelPath,
        filePath,
        fileContent,
        await typecheckOptions(ctx, root, resolvedPanelPath, effectiveContextId)
      );
    },

    async getTypeInfo(
      panelPath: string,
      filePath: string,
      line: number,
      column: number,
      fileContent?: string,
      contextId?: string
    ) {
      const effectiveContextId = invocationContextId(ctx, contextId);
      const root = await typecheckRoot(ctx, effectiveContextId);
      const resolvedPanelPath = resolvePanelPath(root, panelPath, effectiveContextId);
      validateFilePath(root, filePath, effectiveContextId);
      return typeCheckRpcMethods["typecheck.getTypeInfo"](
        resolvedPanelPath,
        filePath,
        line,
        column,
        fileContent,
        await typecheckOptions(ctx, root, resolvedPanelPath, effectiveContextId)
      );
    },

    async getCompletions(
      panelPath: string,
      filePath: string,
      line: number,
      column: number,
      fileContent?: string,
      contextId?: string
    ) {
      const effectiveContextId = invocationContextId(ctx, contextId);
      const root = await typecheckRoot(ctx, effectiveContextId);
      const resolvedPanelPath = resolvePanelPath(root, panelPath, effectiveContextId);
      validateFilePath(root, filePath, effectiveContextId);
      return typeCheckRpcMethods["typecheck.getCompletions"](
        resolvedPanelPath,
        filePath,
        line,
        column,
        fileContent,
        await typecheckOptions(ctx, root, resolvedPanelPath, effectiveContextId)
      );
    },

    async getBrowserTypeDefinitions(options?: BrowserTypeDefinitionsOptions) {
      const opts = options ?? {};
      const packageNames = opts.packageNames ?? [];
      const effectiveContextId = invocationContextId(ctx, opts.contextId);
      const source =
        opts.panelPath ?? (packageNames.length > 0 ? currentCallerPanelPath(ctx) : undefined);

      if (!source) {
        return typeCheckRpcMethods["typecheck.getBrowserTypeDefinitions"](undefined, packageNames);
      }

      const root = await typecheckRoot(ctx, effectiveContextId);
      const resolvedPanelPath = resolvePanelPath(root, source, effectiveContextId);
      return typeCheckRpcMethods["typecheck.getBrowserTypeDefinitions"](
        resolvedPanelPath,
        packageNames,
        await typecheckOptions(ctx, root, resolvedPanelPath, effectiveContextId)
      );
    },
  };
}
