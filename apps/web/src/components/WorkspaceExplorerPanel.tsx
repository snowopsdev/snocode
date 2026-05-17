import type {
  EnvironmentId,
  ProjectDirectoryEntry,
  ProjectListDirectoryResult,
} from "@snocode/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FilePlus2Icon,
  FolderClosedIcon,
  FolderIcon,
  FolderPlusIcon,
  Loader2Icon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import type * as React from "react";
import { memo, useCallback, useMemo, useState } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import {
  insertWorkspaceDirectoryEntry,
  parentPathOf,
  sortWorkspaceDirectoryEntries,
  validateWorkspaceEntryNameDraft,
  workspaceDirectoryQueryKey,
} from "./WorkspaceExplorerPanel.logic";

const ROOT_DIRECTORY_LABEL = "Project";

type WorkspaceExplorerMode = "sidebar" | "sheet";

type SelectionState = {
  readonly path: string;
  readonly kind: ProjectDirectoryEntry["kind"];
} | null;

type OpenFileState = {
  readonly relativePath: string;
  readonly contents: string;
  readonly status: "loading" | "ready" | "error";
  readonly error?: string;
} | null;

type CreateDialogState = {
  readonly kind: "file" | "folder";
  readonly parentPath: string | null;
  readonly name: string;
} | null;

interface WorkspaceExplorerPanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly resolvedTheme: "light" | "dark";
  readonly mode: WorkspaceExplorerMode;
  readonly onClose: () => void;
}

export const WorkspaceExplorerPanel = memo(function WorkspaceExplorerPanel(
  props: WorkspaceExplorerPanelProps,
) {
  const { environmentId, cwd, mode, onClose, resolvedTheme } = props;
  const queryClient = useQueryClient();
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState<SelectionState>(null);
  const [openFile, setOpenFile] = useState<OpenFileState>(null);
  const [createDialog, setCreateDialog] = useState<CreateDialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentCreateParentPath = useMemo(() => {
    if (!selection) {
      return null;
    }
    return selection.kind === "directory" ? selection.path : parentPathOf(selection.path);
  }, [selection]);

  const selectedRefreshPath = useMemo(() => {
    if (!selection) {
      return null;
    }
    return selection.kind === "directory" ? selection.path : parentPathOf(selection.path);
  }, [selection]);

  const setDirectoryExpanded = useCallback((relativePath: string, expanded: boolean) => {
    setExpandedDirectories((current) => ({
      ...current,
      [relativePath]: expanded,
    }));
  }, []);

  const invalidateDirectory = useCallback(
    (relativePath: string | null) =>
      queryClient.invalidateQueries({
        queryKey: workspaceDirectoryQueryKey({ environmentId, cwd, relativePath }),
      }),
    [cwd, environmentId, queryClient],
  );

  const addCreatedEntryToCache = useCallback(
    (input: {
      readonly relativePath: string;
      readonly parentPath: string | null;
      readonly name: string;
      readonly kind: ProjectDirectoryEntry["kind"];
    }) => {
      queryClient.setQueryData<ProjectListDirectoryResult>(
        workspaceDirectoryQueryKey({ environmentId, cwd, relativePath: input.parentPath }),
        (current) =>
          insertWorkspaceDirectoryEntry(current, {
            path: input.relativePath,
            name: input.name,
            kind: input.kind,
            ...(input.parentPath ? { parentPath: input.parentPath } : {}),
          }),
      );
    },
    [cwd, environmentId, queryClient],
  );

  const openCreateDialog = useCallback(
    (kind: "file" | "folder", parentPath: string | null = currentCreateParentPath) => {
      setActionError(null);
      setCreateDialog({
        kind,
        parentPath,
        name: "",
      });
    },
    [currentCreateParentPath],
  );

  const createFileMutation = useMutation({
    mutationFn: async (input: { readonly parentPath: string | null; readonly name: string }) => {
      const api = ensureEnvironmentApi(environmentId);
      return api.projects.createFile({
        cwd,
        ...(input.parentPath ? { parentPath: input.parentPath } : {}),
        name: input.name,
        contents: "",
      });
    },
    onSuccess: (result, input) => {
      addCreatedEntryToCache({
        relativePath: result.relativePath,
        parentPath: input.parentPath,
        name: input.name.trim(),
        kind: "file",
      });
      void invalidateDirectory(input.parentPath);
      setDirectoryExpanded(input.parentPath ?? "", true);
      setSelection({ path: result.relativePath, kind: "file" });
      setOpenFile({
        relativePath: result.relativePath,
        contents: "",
        status: "ready",
      });
      setCreateDialog(null);
      setActionError(null);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Could not create file.");
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async (input: { readonly parentPath: string | null; readonly name: string }) => {
      const api = ensureEnvironmentApi(environmentId);
      return api.projects.createFolder({
        cwd,
        ...(input.parentPath ? { parentPath: input.parentPath } : {}),
        name: input.name,
      });
    },
    onSuccess: (result, input) => {
      addCreatedEntryToCache({
        relativePath: result.relativePath,
        parentPath: input.parentPath,
        name: input.name.trim(),
        kind: "directory",
      });
      void invalidateDirectory(input.parentPath);
      setDirectoryExpanded(input.parentPath ?? "", true);
      setDirectoryExpanded(result.relativePath, true);
      setSelection({ path: result.relativePath, kind: "directory" });
      setCreateDialog(null);
      setActionError(null);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Could not create folder.");
    },
  });

  const readFile = useCallback(
    async (entry: ProjectDirectoryEntry) => {
      setSelection({ path: entry.path, kind: "file" });
      setActionError(null);
      setOpenFile({
        relativePath: entry.path,
        contents: "",
        status: "loading",
      });
      try {
        const api = ensureEnvironmentApi(environmentId);
        const result = await api.projects.readFile({ cwd, relativePath: entry.path });
        setOpenFile({
          relativePath: result.relativePath,
          contents: result.contents,
          status: "ready",
        });
      } catch (error) {
        setOpenFile({
          relativePath: entry.path,
          contents: "",
          status: "error",
          error: error instanceof Error ? error.message : "Could not open file.",
        });
      }
    },
    [cwd, environmentId],
  );

  const submitCreateDialog = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!createDialog) {
        return;
      }
      const validationError = validateWorkspaceEntryNameDraft(createDialog.name);
      if (validationError) {
        setActionError(validationError);
        return;
      }
      const input = {
        parentPath: createDialog.parentPath,
        name: createDialog.name.trim(),
      };
      if (createDialog.kind === "file") {
        createFileMutation.mutate(input);
        return;
      }
      createFolderMutation.mutate(input);
    },
    [createDialog, createFileMutation, createFolderMutation],
  );

  const refreshCurrentDirectory = useCallback(() => {
    void invalidateDirectory(selectedRefreshPath);
  }, [invalidateDirectory, selectedRefreshPath]);

  const createBusy = createFileMutation.isPending || createFolderMutation.isPending;

  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-l border-border bg-card text-card-foreground",
        mode === "sidebar" ? "w-[clamp(20rem,28vw,30rem)] flex-none" : "size-full",
      )}
      aria-label="Workspace files"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">Files</h2>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{cwd}</p>
        </div>
        <WorkspaceExplorerToolbarButton label="New file" onClick={() => openCreateDialog("file")}>
          <FilePlus2Icon className="size-3.5" />
        </WorkspaceExplorerToolbarButton>
        <WorkspaceExplorerToolbarButton
          label="New folder"
          onClick={() => openCreateDialog("folder")}
        >
          <FolderPlusIcon className="size-3.5" />
        </WorkspaceExplorerToolbarButton>
        <WorkspaceExplorerToolbarButton label="Refresh" onClick={refreshCurrentDirectory}>
          <RefreshCwIcon className="size-3.5" />
        </WorkspaceExplorerToolbarButton>
        <WorkspaceExplorerToolbarButton label="Close files" onClick={onClose}>
          <XIcon className="size-3.5" />
        </WorkspaceExplorerToolbarButton>
      </div>

      {actionError ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/8 px-3 py-2 text-destructive text-xs">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{actionError}</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-2 py-2">
            <WorkspaceDirectoryEntries
              cwd={cwd}
              depth={0}
              environmentId={environmentId}
              expandedDirectories={expandedDirectories}
              relativePath={null}
              resolvedTheme={resolvedTheme}
              selectedPath={selection?.path ?? null}
              onCreateInDirectory={openCreateDialog}
              onDirectorySelect={(entry) => {
                setSelection({ path: entry.path, kind: "directory" });
                setDirectoryExpanded(entry.path, !(expandedDirectories[entry.path] ?? false));
              }}
              onFileSelect={readFile}
              onToggleDirectory={(relativePath, expanded) =>
                setDirectoryExpanded(relativePath, expanded)
              }
            />
          </div>
        </ScrollArea>

        {openFile ? (
          <div className="flex max-h-[42%] min-h-36 shrink-0 flex-col border-t border-border bg-background">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
              <VscodeEntryIcon
                pathValue={openFile.relativePath}
                kind="file"
                theme={resolvedTheme}
                className="size-3.5"
              />
              <span className="min-w-0 truncate font-mono text-[11px]">
                {openFile.relativePath}
              </span>
              <Button
                aria-label="Close file tab"
                className="ml-auto"
                size="icon-xs"
                variant="ghost"
                onClick={() => setOpenFile(null)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {openFile.status === "loading" ? (
                <div className="flex h-full items-center justify-center gap-2 p-4 text-muted-foreground text-xs">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Opening file...
                </div>
              ) : openFile.status === "error" ? (
                <div className="p-3 text-destructive text-xs">{openFile.error}</div>
              ) : (
                <pre className="min-h-full whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5">
                  {openFile.contents}
                </pre>
              )}
            </ScrollArea>
          </div>
        ) : null}
      </div>

      <Dialog
        open={createDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialog(null);
            setActionError(null);
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{createDialog?.kind === "folder" ? "New Folder" : "New File"}</DialogTitle>
            <DialogDescription>
              {createDialog?.parentPath ? createDialog.parentPath : ROOT_DIRECTORY_LABEL}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id="workspace-create-entry-form" onSubmit={submitCreateDialog}>
              <Input
                autoFocus
                nativeInput
                aria-label={createDialog?.kind === "folder" ? "Folder name" : "File name"}
                placeholder={createDialog?.kind === "folder" ? "components" : "notes.md"}
                value={createDialog?.name ?? ""}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setActionError(null);
                  setCreateDialog((current) => (current ? { ...current, name } : current));
                }}
              />
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreateDialog(null);
                setActionError(null);
              }}
            >
              Cancel
            </Button>
            <Button form="workspace-create-entry-form" type="submit" disabled={createBusy}>
              {createBusy ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </section>
  );
});

function WorkspaceExplorerToolbarButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={props.label}
            className="shrink-0"
            size="icon-xs"
            variant="ghost"
            onClick={props.onClick}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function WorkspaceDirectoryEntries(props: {
  readonly cwd: string;
  readonly depth: number;
  readonly environmentId: EnvironmentId;
  readonly expandedDirectories: Record<string, boolean>;
  readonly relativePath: string | null;
  readonly resolvedTheme: "light" | "dark";
  readonly selectedPath: string | null;
  readonly onCreateInDirectory: (kind: "file" | "folder", parentPath: string | null) => void;
  readonly onDirectorySelect: (entry: ProjectDirectoryEntry) => void;
  readonly onFileSelect: (entry: ProjectDirectoryEntry) => void;
  readonly onToggleDirectory: (relativePath: string, expanded: boolean) => void;
}) {
  const { cwd, environmentId, relativePath } = props;
  const directoryQuery = useQuery({
    queryKey: workspaceDirectoryQueryKey({ environmentId, cwd, relativePath }),
    queryFn: async () => {
      const api = ensureEnvironmentApi(environmentId);
      return api.projects.listDirectory({
        cwd,
        ...(relativePath ? { relativePath } : {}),
      });
    },
    staleTime: 5_000,
  });

  if (directoryQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-xs">
        <Loader2Icon className="size-3 animate-spin" />
        Loading...
      </div>
    );
  }

  if (directoryQuery.isError) {
    return (
      <div className="flex items-start gap-2 px-2 py-1.5 text-destructive text-xs">
        <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>{directoryQuery.error.message}</span>
      </div>
    );
  }

  const entries = sortWorkspaceDirectoryEntries(directoryQuery.data?.entries ?? []);
  if (entries.length === 0) {
    return <div className="px-2 py-1.5 text-muted-foreground text-xs">Empty</div>;
  }

  return (
    <div className="space-y-0.5">
      {entries.map((entry) => (
        <WorkspaceEntryRow key={entry.path} entry={entry} {...props} />
      ))}
    </div>
  );
}

function WorkspaceEntryRow(props: {
  readonly cwd: string;
  readonly depth: number;
  readonly entry: ProjectDirectoryEntry;
  readonly environmentId: EnvironmentId;
  readonly expandedDirectories: Record<string, boolean>;
  readonly resolvedTheme: "light" | "dark";
  readonly selectedPath: string | null;
  readonly onCreateInDirectory: (kind: "file" | "folder", parentPath: string | null) => void;
  readonly onDirectorySelect: (entry: ProjectDirectoryEntry) => void;
  readonly onFileSelect: (entry: ProjectDirectoryEntry) => void;
  readonly onToggleDirectory: (relativePath: string, expanded: boolean) => void;
}) {
  const { entry } = props;
  const leftPadding = 8 + props.depth * 14;
  const selected = props.selectedPath === entry.path;

  if (entry.kind === "directory") {
    const expanded = props.expandedDirectories[entry.path] ?? false;
    return (
      <div>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80",
            selected && "bg-background text-foreground",
          )}
          style={{ paddingLeft: `${leftPadding}px` }}
          onClick={() => props.onDirectorySelect(entry)}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onCreateInDirectory("file", entry.path);
          }}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
              expanded && "rotate-90",
            )}
          />
          {expanded ? (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          ) : (
            <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          )}
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
            {entry.name}
          </span>
        </button>
        {expanded ? (
          <WorkspaceDirectoryEntries {...props} depth={props.depth + 1} relativePath={entry.path} />
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80",
        selected && "bg-background text-foreground",
      )}
      style={{ paddingLeft: `${leftPadding}px` }}
      onClick={() => props.onFileSelect(entry)}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <VscodeEntryIcon
        pathValue={entry.path}
        kind="file"
        theme={props.resolvedTheme}
        className="size-3.5 text-muted-foreground/70"
      />
      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
        {entry.name}
      </span>
    </button>
  );
}

export default WorkspaceExplorerPanel;
