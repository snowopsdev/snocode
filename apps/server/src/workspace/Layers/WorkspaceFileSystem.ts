// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFs from "node:fs/promises";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const HARD_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  ".next",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "out",
]);
const VISIBLE_DOT_DIRECTORY_NAMES = new Set([".github"]);
const WINDOWS_INVALID_NAME_CHARACTERS = /[<>:"|?*]/u;
const WINDOWS_RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function errorCode(cause: unknown): string | undefined {
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function makeError(input: {
  readonly cwd: string;
  readonly relativePath?: string | undefined;
  readonly operation: string;
  readonly detail: string;
  readonly code?: string | undefined;
  readonly cause?: unknown;
}): WorkspaceFileSystemError {
  return new WorkspaceFileSystemError({
    cwd: input.cwd,
    ...(input.relativePath !== undefined ? { relativePath: input.relativePath } : {}),
    operation: input.operation,
    detail: input.detail,
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

function directoryEntryParentPath(relativePath: string | null): { readonly parentPath?: string } {
  return relativePath ? { parentPath: relativePath } : {};
}

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const assertRealPathWithinRoot = (input: {
    readonly cwd: string;
    readonly workspaceRoot: string;
    readonly realPath: string;
    readonly relativePath?: string | undefined;
    readonly operation: string;
  }) => {
    const relativeToRoot = toPosixPath(path.relative(input.workspaceRoot, input.realPath));
    if (
      relativeToRoot.length === 0 ||
      (!relativeToRoot.startsWith("../") &&
        relativeToRoot !== ".." &&
        !path.isAbsolute(relativeToRoot))
    ) {
      return Effect.void;
    }

    return Effect.fail(
      makeError({
        cwd: input.cwd,
        relativePath: input.relativePath,
        operation: input.operation,
        detail: "Workspace path must stay within the project root.",
        code: "outside-root",
      }),
    );
  };

  const realpath = (input: {
    readonly cwd: string;
    readonly absolutePath: string;
    readonly relativePath?: string | undefined;
    readonly operation: string;
  }) =>
    Effect.tryPromise({
      try: () => NodeFs.realpath(input.absolutePath),
      catch: (cause) =>
        makeError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: input.operation,
          detail: errorMessage(cause),
          code: errorCode(cause),
          cause,
        }),
    });

  const statPath = (input: {
    readonly cwd: string;
    readonly absolutePath: string;
    readonly relativePath?: string | undefined;
    readonly operation: string;
  }) =>
    fileSystem.stat(input.absolutePath).pipe(
      Effect.mapError((cause) =>
        makeError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: input.operation,
          detail: cause.message,
          cause,
        }),
      ),
    );

  const assertExistingPathWithinRoot = Effect.fn(
    "WorkspaceFileSystem.assertExistingPathWithinRoot",
  )(function* (input: {
    readonly cwd: string;
    readonly workspaceRoot: string;
    readonly absolutePath: string;
    readonly relativePath?: string | undefined;
    readonly operation: string;
  }) {
    const rootRealPath = yield* realpath({
      cwd: input.cwd,
      absolutePath: input.workspaceRoot,
      operation: `${input.operation}.rootRealpath`,
    });
    const targetRealPath = yield* realpath(input);
    yield* assertRealPathWithinRoot({
      cwd: input.cwd,
      workspaceRoot: rootRealPath,
      realPath: targetRealPath,
      relativePath: input.relativePath,
      operation: input.operation,
    });
  });

  const assertExistingPathWithinRootIfPresent = Effect.fn(
    "WorkspaceFileSystem.assertExistingPathWithinRootIfPresent",
  )(function* (input: {
    readonly cwd: string;
    readonly workspaceRoot: string;
    readonly absolutePath: string;
    readonly relativePath?: string | undefined;
    readonly operation: string;
  }) {
    const existingStat = yield* fileSystem
      .stat(input.absolutePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!existingStat) {
      return;
    }
    yield* assertExistingPathWithinRoot(input);
  });

  const assertAncestorWithinRoot = Effect.fn("WorkspaceFileSystem.assertAncestorWithinRoot")(
    function* (input: {
      readonly cwd: string;
      readonly workspaceRoot: string;
      readonly absolutePath: string;
      readonly relativePath?: string | undefined;
      readonly operation: string;
    }) {
      const rootRealPath = yield* realpath({
        cwd: input.cwd,
        absolutePath: input.workspaceRoot,
        operation: `${input.operation}.rootRealpath`,
      });
      let candidatePath = input.absolutePath;
      while (true) {
        const existingStat = yield* fileSystem
          .stat(candidatePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (existingStat) {
          const candidateRealPath = yield* realpath({
            cwd: input.cwd,
            absolutePath: candidatePath,
            relativePath: input.relativePath,
            operation: input.operation,
          });
          yield* assertRealPathWithinRoot({
            cwd: input.cwd,
            workspaceRoot: rootRealPath,
            realPath: candidateRealPath,
            relativePath: input.relativePath,
            operation: input.operation,
          });
          return;
        }
        const nextPath = path.dirname(candidatePath);
        if (nextPath === candidatePath) {
          return yield* makeError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: input.operation,
            detail: "Workspace root does not exist.",
            code: "workspace-root-missing",
          });
        }
        candidatePath = nextPath;
      }
    },
  );

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceFileSystem.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ) {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError((cause) =>
        makeError({
          cwd,
          operation: "workspaceFileSystem.normalizeWorkspaceRoot",
          detail: cause.message,
          cause,
        }),
      ),
    );
  });

  const resolveDirectoryTarget = Effect.fn("WorkspaceFileSystem.resolveDirectoryTarget")(
    function* (input: {
      readonly cwd: string;
      readonly relativePath?: string | undefined;
      readonly operation: string;
    }) {
      const workspaceRoot = yield* normalizeWorkspaceRoot(input.cwd);
      if (!input.relativePath) {
        yield* assertExistingPathWithinRoot({
          cwd: input.cwd,
          workspaceRoot,
          absolutePath: workspaceRoot,
          operation: input.operation,
        });
        return {
          workspaceRoot,
          absolutePath: workspaceRoot,
          relativePath: null,
        };
      }

      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot,
        relativePath: input.relativePath,
      });
      yield* assertExistingPathWithinRoot({
        cwd: input.cwd,
        workspaceRoot,
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
        operation: input.operation,
      });
      return {
        workspaceRoot,
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
      };
    },
  );

  const validatePathSegment = (input: {
    readonly cwd: string;
    readonly name: string;
    readonly parentPath?: string | undefined;
    readonly operation: string;
  }) => {
    const name = input.name.trim();
    if (name.length === 0) {
      return Effect.fail(
        makeError({
          cwd: input.cwd,
          relativePath: input.parentPath,
          operation: input.operation,
          detail: "File or folder name cannot be empty.",
          code: "invalid-name",
        }),
      );
    }
    if (
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      WINDOWS_INVALID_NAME_CHARACTERS.test(name) ||
      WINDOWS_RESERVED_DEVICE_NAME.test(name) ||
      name.endsWith(" ") ||
      name.endsWith(".")
    ) {
      return Effect.fail(
        makeError({
          cwd: input.cwd,
          relativePath: input.parentPath,
          operation: input.operation,
          detail: "File or folder name contains invalid characters.",
          code: "invalid-name",
        }),
      );
    }
    return Effect.succeed(name);
  };

  const resolveChildTarget = Effect.fn("WorkspaceFileSystem.resolveChildTarget")(function* (input: {
    readonly cwd: string;
    readonly parentPath?: string | undefined;
    readonly name: string;
    readonly operation: string;
  }) {
    const name = yield* validatePathSegment(input);
    const parent = yield* resolveDirectoryTarget({
      cwd: input.cwd,
      relativePath: input.parentPath,
      operation: `${input.operation}.parent`,
    });
    const parentStat = yield* statPath({
      cwd: input.cwd,
      absolutePath: parent.absolutePath,
      relativePath: parent.relativePath ?? undefined,
      operation: `${input.operation}.statParent`,
    });
    if (parentStat.type !== "Directory") {
      return yield* makeError({
        cwd: input.cwd,
        relativePath: parent.relativePath ?? undefined,
        operation: input.operation,
        detail: "Parent path must be a directory.",
        code: "not-directory",
      });
    }
    const relativePath = parent.relativePath ? `${parent.relativePath}/${name}` : name;
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: parent.workspaceRoot,
      relativePath,
    });
    yield* assertAncestorWithinRoot({
      cwd: input.cwd,
      workspaceRoot: parent.workspaceRoot,
      absolutePath: parent.absolutePath,
      relativePath: parent.relativePath ?? undefined,
      operation: input.operation,
    });
    return {
      workspaceRoot: parent.workspaceRoot,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      parentPath: parent.relativePath,
    };
  });

  const filterVcsIgnoredPaths = (
    cwd: string,
    relativePaths: string[],
  ): Effect.Effect<string[], never> =>
    vcsRegistry.detect({ cwd }).pipe(
      Effect.flatMap((handle) =>
        handle
          ? handle.driver.filterIgnoredPaths(cwd, relativePaths).pipe(
              Effect.map((paths) => [...paths]),
              Effect.catch(() => Effect.succeed(relativePaths)),
            )
          : Effect.succeed(relativePaths),
      ),
      Effect.catch(() => Effect.succeed(relativePaths)),
    );

  const listDirectory: WorkspaceFileSystemShape["listDirectory"] = Effect.fn(
    "WorkspaceFileSystem.listDirectory",
  )(function* (input) {
    const target = yield* resolveDirectoryTarget({
      cwd: input.cwd,
      relativePath: input.relativePath,
      operation: "workspaceFileSystem.listDirectory",
    });
    const targetStat = yield* statPath({
      cwd: input.cwd,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath ?? undefined,
      operation: "workspaceFileSystem.listDirectory.stat",
    });
    if (targetStat.type !== "Directory") {
      return yield* makeError({
        cwd: input.cwd,
        relativePath: target.relativePath ?? undefined,
        operation: "workspaceFileSystem.listDirectory",
        detail: "Path must be a directory.",
        code: "not-directory",
      });
    }

    const entries = yield* Effect.tryPromise({
      try: () => NodeFs.readdir(target.absolutePath, { withFileTypes: true }),
      catch: (cause) =>
        makeError({
          cwd: input.cwd,
          relativePath: target.relativePath ?? undefined,
          operation: "workspaceFileSystem.listDirectory.readdir",
          detail: errorMessage(cause),
          code: errorCode(cause),
          cause,
        }),
    });

    const visibleEntries = entries.flatMap((entry) => {
      const kind = entry.isDirectory()
        ? ("directory" as const)
        : entry.isFile()
          ? ("file" as const)
          : null;
      if (!kind) {
        return [];
      }
      if (kind === "directory" && HARD_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        return [];
      }
      if (
        !input.includeHidden &&
        entry.name.startsWith(".") &&
        !(kind === "directory" && VISIBLE_DOT_DIRECTORY_NAMES.has(entry.name))
      ) {
        return [];
      }
      const entryPath = target.relativePath ? `${target.relativePath}/${entry.name}` : entry.name;
      return [
        {
          path: toPosixPath(entryPath),
          name: entry.name,
          kind,
          ...directoryEntryParentPath(target.relativePath),
        },
      ];
    });
    const allowedPaths = new Set(
      yield* filterVcsIgnoredPaths(
        target.workspaceRoot,
        visibleEntries.map((entry) => entry.path),
      ),
    );

    return {
      relativePath: target.relativePath,
      entries: visibleEntries
        .filter((entry) => allowedPaths.has(entry.path))
        .toSorted((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
          }
          return left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
            numeric: true,
          });
        }),
    };
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const workspaceRoot = yield* normalizeWorkspaceRoot(input.cwd);
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot,
        relativePath: input.relativePath,
      });
      yield* assertExistingPathWithinRoot({
        cwd: input.cwd,
        workspaceRoot,
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
        operation: "workspaceFileSystem.readFile",
      });
      const targetStat = yield* statPath({
        cwd: input.cwd,
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
        operation: "workspaceFileSystem.readFile.stat",
      });
      if (targetStat.type !== "File") {
        return yield* makeError({
          cwd: input.cwd,
          relativePath: target.relativePath,
          operation: "workspaceFileSystem.readFile",
          detail: "Path must be a file.",
          code: "not-file",
        });
      }
      const contents = yield* fileSystem.readFileString(target.absolutePath).pipe(
        Effect.mapError((cause) =>
          makeError({
            cwd: input.cwd,
            relativePath: target.relativePath,
            operation: "workspaceFileSystem.readFile.read",
            detail: cause.message,
            cause,
          }),
        ),
      );
      return { relativePath: target.relativePath, contents };
    },
  );

  const createFile: WorkspaceFileSystemShape["createFile"] = Effect.fn(
    "WorkspaceFileSystem.createFile",
  )(function* (input) {
    const target = yield* resolveChildTarget({
      cwd: input.cwd,
      parentPath: input.parentPath,
      name: input.name,
      operation: "workspaceFileSystem.createFile",
    });
    yield* Effect.tryPromise({
      try: () =>
        NodeFs.writeFile(target.absolutePath, input.contents ?? "", {
          encoding: "utf8",
          flag: "wx",
        }),
      catch: (cause) => {
        const code = errorCode(cause);
        return makeError({
          cwd: input.cwd,
          relativePath: target.relativePath,
          operation: "workspaceFileSystem.createFile.write",
          detail:
            code === "EEXIST"
              ? "A file or folder already exists at this path."
              : errorMessage(cause),
          code: code === "EEXIST" ? "already-exists" : code,
          cause,
        });
      },
    });
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const createFolder: WorkspaceFileSystemShape["createFolder"] = Effect.fn(
    "WorkspaceFileSystem.createFolder",
  )(function* (input) {
    const target = yield* resolveChildTarget({
      cwd: input.cwd,
      parentPath: input.parentPath,
      name: input.name,
      operation: "workspaceFileSystem.createFolder",
    });
    yield* Effect.tryPromise({
      try: () => NodeFs.mkdir(target.absolutePath),
      catch: (cause) => {
        const code = errorCode(cause);
        return makeError({
          cwd: input.cwd,
          relativePath: target.relativePath,
          operation: "workspaceFileSystem.createFolder.mkdir",
          detail:
            code === "EEXIST"
              ? "A file or folder already exists at this path."
              : errorMessage(cause),
          code: code === "EEXIST" ? "already-exists" : code,
          cause,
        });
      },
    });
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const workspaceRoot = yield* normalizeWorkspaceRoot(input.cwd);
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot,
      relativePath: input.relativePath,
    });
    const parentDirectory = path.dirname(target.absolutePath);
    yield* assertAncestorWithinRoot({
      cwd: input.cwd,
      workspaceRoot,
      absolutePath: parentDirectory,
      relativePath: target.relativePath,
      operation: "workspaceFileSystem.writeFile.parent",
    });
    yield* assertExistingPathWithinRootIfPresent({
      cwd: input.cwd,
      workspaceRoot,
      absolutePath: target.absolutePath,
      relativePath: target.relativePath,
      operation: "workspaceFileSystem.writeFile.target",
    });

    yield* fileSystem.makeDirectory(parentDirectory, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        makeError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.makeDirectory",
          detail: cause.message,
          cause,
        }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError((cause) =>
        makeError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.writeFile",
          detail: cause.message,
          cause,
        }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });
  return {
    listDirectory,
    readFile,
    createFile,
    createFolder,
    writeFile,
  } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
