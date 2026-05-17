import type {
  EnvironmentId,
  ProjectDirectoryEntry,
  ProjectListDirectoryResult,
} from "@snocode/contracts";

export function workspaceDirectoryQueryKey(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string | null;
}) {
  return ["workspace-explorer", input.environmentId, input.cwd, input.relativePath] as const;
}

export function sortWorkspaceDirectoryEntries(
  entries: ReadonlyArray<ProjectDirectoryEntry>,
): ProjectDirectoryEntry[] {
  return entries.toSorted((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export function insertWorkspaceDirectoryEntry(
  directory: ProjectListDirectoryResult | undefined,
  entry: ProjectDirectoryEntry,
): ProjectListDirectoryResult | undefined {
  if (!directory) {
    return directory;
  }
  const nextEntries = directory.entries.filter((existing) => existing.path !== entry.path);
  nextEntries.push(entry);
  return {
    ...directory,
    entries: sortWorkspaceDirectoryEntries(nextEntries),
  };
}

export function parentPathOf(relativePath: string): string | null {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex === -1 ? null : relativePath.slice(0, separatorIndex);
}

export function validateWorkspaceEntryNameDraft(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Name cannot be empty.";
  }
  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    /[<>:"|?*]/u.test(trimmed) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(trimmed) ||
    trimmed.endsWith(" ") ||
    trimmed.endsWith(".")
  ) {
    return "Name contains invalid characters.";
  }
  return null;
}
