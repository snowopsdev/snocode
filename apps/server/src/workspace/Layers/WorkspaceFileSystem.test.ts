import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../../config.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspaceFileSystemLive } from "./WorkspaceFileSystem.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const ProjectLayer = WorkspaceFileSystemLive.pipe(
  Layer.provide(WorkspacePathsLive),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "snocode-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "snocode-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("WorkspaceFileSystemLive", (it) => {
  describe("listDirectory", () => {
    it.effect("lists direct workspace children while filtering heavy and hidden directories", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));
        yield* fileSystem.makeDirectory(path.join(cwd, ".github"));
        yield* fileSystem.makeDirectory(path.join(cwd, "node_modules"));
        yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "# ok\n");
        yield* fileSystem.writeFileString(path.join(cwd, ".env"), "SECRET=1\n");

        const result = yield* workspaceFileSystem.listDirectory({ cwd });

        expect(result.relativePath).toBeNull();
        expect(result.entries.map((entry) => entry.path)).toEqual([".github", "src", "README.md"]);
      }),
    );
  });

  describe("createFile", () => {
    it.effect("creates files without overwriting and invalidates the search cache", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));

        const beforeCreate = yield* workspaceEntries.search({
          cwd,
          query: "fresh",
          limit: 10,
        });
        expect(beforeCreate.entries).toEqual([]);

        const result = yield* workspaceFileSystem.createFile({
          cwd,
          parentPath: "src",
          name: "fresh-note.md",
          contents: "# fresh\n",
        });
        const saved = yield* fileSystem.readFileString(path.join(cwd, "src", "fresh-note.md"));
        const afterCreate = yield* workspaceEntries.search({
          cwd,
          query: "fresh",
          limit: 10,
        });

        expect(result).toEqual({ relativePath: "src/fresh-note.md" });
        expect(saved).toBe("# fresh\n");
        expect(afterCreate.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "src/fresh-note.md" })]),
        );
      }),
    );

    it.effect("rejects duplicate file names", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "README.md", "# existing\n");

        const error = yield* workspaceFileSystem
          .createFile({
            cwd,
            name: "README.md",
          })
          .pipe(Effect.flip);

        expect("code" in error ? error.code : undefined).toBe("already-exists");
      }),
    );

    it.effect("rejects path traversal through parent paths", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .createFile({
            cwd,
            parentPath: "../outside",
            name: "escape.md",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../outside",
        );
      }),
    );

    it.effect("rejects invalid names", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .createFile({
            cwd,
            name: "../escape.md",
          })
          .pipe(Effect.flip);

        expect("code" in error ? error.code : undefined).toBe("invalid-name");
      }),
    );

    it.effect("rejects symlink parents that escape the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const outside = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.symlink(outside, path.join(cwd, "linked-outside"));

        const error = yield* workspaceFileSystem
          .createFile({
            cwd,
            parentPath: "linked-outside",
            name: "escape.md",
          })
          .pipe(Effect.flip);
        const escapedStat = yield* fileSystem
          .stat(path.join(outside, "escape.md"))
          .pipe(Effect.catch(() => Effect.succeed(null)));

        expect("code" in error ? error.code : undefined).toBe("outside-root");
        expect(escapedStat).toBeNull();
      }),
    );
  });

  describe("createFolder", () => {
    it.effect("creates folders without overwriting", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const result = yield* workspaceFileSystem.createFolder({
          cwd,
          name: "docs",
        });
        const stat = yield* fileSystem.stat(path.join(cwd, "docs"));
        const conflict = yield* workspaceFileSystem
          .createFolder({
            cwd,
            name: "docs",
          })
          .pipe(Effect.flip);

        expect(result).toEqual({ relativePath: "docs" });
        expect(stat.type).toBe("Directory");
        expect("code" in conflict ? conflict.code : undefined).toBe("already-exists");
      }),
    );
  });

  describe("readFile", () => {
    it.effect("reads files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "notes/today.md", "hello\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "notes/today.md",
        });

        expect(result).toEqual({
          relativePath: "notes/today.md",
          contents: "hello\n",
        });
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(beforeWrite).toEqual({
          entries: [],
          truncated: false,
        });

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        expect(escapedStat).toBeNull();
      }),
    );
  });
});
