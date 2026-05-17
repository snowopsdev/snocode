import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_FILE_NAME_MAX_LENGTH = 255;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectDirectoryEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectDirectoryEntry = typeof ProjectDirectoryEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  ),
  includeHidden: Schema.optional(Schema.Boolean),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  relativePath: Schema.NullOr(TrimmedNonEmptyString),
  entries: Schema.Array(ProjectDirectoryEntry),
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    code: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    code: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  parentPath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  ),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_FILE_NAME_MAX_LENGTH)),
  contents: Schema.optional(Schema.String),
});
export type ProjectCreateFileInput = typeof ProjectCreateFileInput.Type;

export const ProjectCreateFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateFileResult = typeof ProjectCreateFileResult.Type;

export class ProjectCreateFileError extends Schema.TaggedErrorClass<ProjectCreateFileError>()(
  "ProjectCreateFileError",
  {
    message: TrimmedNonEmptyString,
    code: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateFolderInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  parentPath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  ),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_FILE_NAME_MAX_LENGTH)),
});
export type ProjectCreateFolderInput = typeof ProjectCreateFolderInput.Type;

export const ProjectCreateFolderResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateFolderResult = typeof ProjectCreateFolderResult.Type;

export class ProjectCreateFolderError extends Schema.TaggedErrorClass<ProjectCreateFolderError>()(
  "ProjectCreateFolderError",
  {
    message: TrimmedNonEmptyString,
    code: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
