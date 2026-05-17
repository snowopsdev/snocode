import { describe, expect, it } from "vitest";

import {
  insertWorkspaceDirectoryEntry,
  parentPathOf,
  validateWorkspaceEntryNameDraft,
} from "./WorkspaceExplorerPanel.logic";

describe("WorkspaceExplorerPanel logic", () => {
  it("inserts created entries in directory-first order", () => {
    const result = insertWorkspaceDirectoryEntry(
      {
        relativePath: null,
        entries: [
          { path: "README.md", name: "README.md", kind: "file" },
          { path: "src", name: "src", kind: "directory" },
        ],
      },
      { path: "docs", name: "docs", kind: "directory" },
    );

    expect(result?.entries.map((entry) => entry.path)).toEqual(["docs", "src", "README.md"]);
  });

  it("derives file parent paths", () => {
    expect(parentPathOf("src/index.ts")).toBe("src");
    expect(parentPathOf("README.md")).toBeNull();
  });

  it("rejects unsafe create names before submitting", () => {
    expect(validateWorkspaceEntryNameDraft("")).toBe("Name cannot be empty.");
    expect(validateWorkspaceEntryNameDraft("../escape.ts")).toBe(
      "Name contains invalid characters.",
    );
    expect(validateWorkspaceEntryNameDraft("CON")).toBe("Name contains invalid characters.");
    expect(validateWorkspaceEntryNameDraft("notes.md")).toBeNull();
  });
});
