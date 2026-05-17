import { RefreshCwIcon, ScanLineIcon, SendIcon, Wand2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildBrowserPreviewProxyUrl,
  previewContextLabel,
  type BrowserPreviewAppendRequest,
  type BrowserPreviewElementContext,
} from "~/lib/browserPreviewContext";
import { cn, randomUUID } from "~/lib/utils";

import type { DiffPanelMode } from "./DiffPanelShell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

type BrowserPreviewMessage =
  | {
      source: "snocode-browser-preview";
      type: "ready";
      payload: { pageUrl: string; title: string };
    }
  | {
      source: "snocode-browser-preview";
      type: "element-selected";
      payload: BrowserPreviewElementContext;
    }
  | {
      source: "snocode-browser-preview";
      type: "selector-verified";
      payload:
        | { found: false }
        | { found: true; selector: string; context: BrowserPreviewElementContext };
    };

function isBrowserPreviewMessage(value: unknown): value is BrowserPreviewMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    value.source === "snocode-browser-preview" &&
    "type" in value
  );
}

function normalizeTargetUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function postToPreview(frame: HTMLIFrameElement | null, message: Record<string, unknown>) {
  frame?.contentWindow?.postMessage(
    {
      source: "snocode-browser-preview-host",
      ...message,
    },
    "*",
  );
}

export function BrowserPreviewPanel(props: {
  mode: DiffPanelMode;
  targetUrl?: string | undefined;
  latestTurnCompletedAt?: string | null | undefined;
  onClose: () => void;
  onTargetUrlChange: (url: string) => void;
  onAppendContext: (request: BrowserPreviewAppendRequest) => void;
}) {
  const { latestTurnCompletedAt, mode, onAppendContext, onClose, onTargetUrlChange, targetUrl } =
    props;
  const [draftUrl, setDraftUrl] = useState(targetUrl ?? "http://localhost:3000/");
  const [reloadKey, setReloadKey] = useState(0);
  const [selectMode, setSelectMode] = useState(true);
  const [selectedContext, setSelectedContext] = useState<BrowserPreviewElementContext | null>(null);
  const [verification, setVerification] = useState<
    | { state: "idle" }
    | { state: "found"; selector: string; context: BrowserPreviewElementContext }
    | { state: "missing" }
  >({ state: "idle" });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const latestHandledTurnCompletedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (targetUrl && targetUrl !== draftUrl) {
      setDraftUrl(targetUrl);
    }
  }, [draftUrl, targetUrl]);

  const normalizedUrl = useMemo(() => normalizeTargetUrl(targetUrl ?? ""), [targetUrl]);
  const iframeSrc = normalizedUrl
    ? `${buildBrowserPreviewProxyUrl(normalizedUrl)}&reload=${reloadKey}`
    : null;

  const verifySelectedElement = useCallback(() => {
    if (!selectedContext) return;
    postToPreview(iframeRef.current, {
      type: "verify-selector",
      selectors: selectedContext.selectorCandidates,
    });
  }, [selectedContext]);

  const syncPreviewState = useCallback(() => {
    postToPreview(iframeRef.current, { type: "set-select-mode", enabled: selectMode });
    verifySelectedElement();
  }, [selectMode, verifySelectedElement]);

  useEffect(() => {
    postToPreview(iframeRef.current, { type: "set-select-mode", enabled: selectMode });
  }, [selectMode]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBrowserPreviewMessage(event.data)) return;
      if (event.data.type === "ready") {
        syncPreviewState();
        return;
      }
      if (event.data.type === "element-selected") {
        setSelectedContext(event.data.payload);
        setVerification({
          state: "found",
          selector: event.data.payload.selectorCandidates[0] ?? "",
          context: event.data.payload,
        });
        return;
      }
      if (event.data.type === "selector-verified") {
        setVerification(
          event.data.payload.found
            ? {
                state: "found",
                selector: event.data.payload.selector,
                context: event.data.payload.context,
              }
            : { state: "missing" },
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [syncPreviewState]);

  useEffect(() => {
    if (
      !latestTurnCompletedAt ||
      !selectedContext ||
      latestHandledTurnCompletedAtRef.current === latestTurnCompletedAt
    ) {
      return;
    }
    latestHandledTurnCompletedAtRef.current = latestTurnCompletedAt;
    setReloadKey((key) => key + 1);
  }, [latestTurnCompletedAt, selectedContext]);

  const loadUrl = useCallback(() => {
    const nextUrl = normalizeTargetUrl(draftUrl);
    if (!nextUrl) return;
    onTargetUrlChange(nextUrl);
    setSelectedContext(null);
    setVerification({ state: "idle" });
    setReloadKey((key) => key + 1);
  }, [draftUrl, onTargetUrlChange]);

  const appendContext = useCallback(
    (mode: BrowserPreviewAppendRequest["mode"]) => {
      if (!selectedContext) return;
      onAppendContext({
        id: randomUUID(),
        context: selectedContext,
        mode,
      });
    },
    [onAppendContext, selectedContext],
  );

  return (
    <div
      className={cn("flex h-full min-w-0 flex-col bg-background", mode === "sidebar" && "w-full")}
    >
      <div className="border-b border-border">
        <div className="flex h-12 items-center gap-2 px-3">
          <ScanLineIcon className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-sm font-medium">Browser Preview</div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            Select
            <Switch
              checked={selectMode}
              onCheckedChange={(checked) => setSelectMode(Boolean(checked))}
              aria-label="Toggle element selection"
            />
          </label>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close browser preview"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
      </div>

      <form
        className="flex gap-2 border-b border-border/70 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          loadUrl();
        }}
      >
        <Input
          nativeInput
          size="sm"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.currentTarget.value)}
          placeholder="http://localhost:3000/"
          aria-label="Preview URL"
        />
        <Button size="sm" type="submit">
          Open
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Reload preview"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={!iframeSrc}
        >
          <RefreshCwIcon />
        </Button>
      </form>

      <div className="min-h-0 flex-1 bg-muted/20">
        {iframeSrc ? (
          <iframe
            key={`${iframeSrc}:${reloadKey}`}
            ref={iframeRef}
            src={iframeSrc}
            title="Browser preview"
            className="h-full w-full border-0 bg-background"
            sandbox="allow-scripts allow-forms allow-popups"
            onLoad={syncPreviewState}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Enter a local dev URL to open the preview.
          </div>
        )}
      </div>

      <div className="max-h-60 overflow-auto border-t border-border bg-background p-3">
        {selectedContext ? (
          <div className="space-y-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {previewContextLabel(selectedContext)}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {selectedContext.selectorCandidates[0] ?? selectedContext.domPath}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => appendContext("context")}>
                <SendIcon />
                Attach
              </Button>
              <Button size="xs" onClick={() => appendContext("change-template")}>
                <Wand2Icon />
                Change
              </Button>
              <Button size="xs" variant="ghost" onClick={verifySelectedElement}>
                Verify
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {verification.state === "found"
                ? `Verified: ${verification.selector || "matched selected element"}`
                : verification.state === "missing"
                  ? "Selected element was not found after reload."
                  : "Selection captured."}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Click a visible element in the preview to capture DOM context.
          </div>
        )}
      </div>
    </div>
  );
}
