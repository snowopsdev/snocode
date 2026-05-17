export interface BrowserPreviewElementContext {
  capturedAt: string;
  pageUrl: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  tagName: string;
  text: string;
  accessibleName: string;
  role: string;
  attributes: Record<string, string>;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
  };
  computedStyle: Record<string, string>;
  domPath: string;
  selectorCandidates: string[];
  nearbyText: {
    parent: string;
    previous: string;
    next: string;
  };
}

export interface BrowserPreviewAppendRequest {
  id: string;
  context: BrowserPreviewElementContext;
  mode: "context" | "change-template";
}

export interface BrowserPreviewContextDraft extends BrowserPreviewAppendRequest {
  createdAt: string;
}

export function buildBrowserPreviewProxyUrl(targetUrl: string): string {
  return `/api/browser-preview?url=${encodeURIComponent(targetUrl)}`;
}

function compactContext(context: BrowserPreviewElementContext) {
  return {
    pageUrl: context.pageUrl,
    title: context.title,
    tagName: context.tagName,
    text: context.text,
    accessibleName: context.accessibleName,
    role: context.role,
    attributes: context.attributes,
    boundingRect: context.boundingRect,
    computedStyle: context.computedStyle,
    domPath: context.domPath,
    selectorCandidates: context.selectorCandidates,
    nearbyText: context.nearbyText,
  };
}

export function formatBrowserPreviewContextForPrompt(
  context: BrowserPreviewElementContext,
  mode: BrowserPreviewAppendRequest["mode"],
): string {
  const heading =
    mode === "change-template"
      ? "Change the selected UI element described below. Keep the change targeted and verify it in the preview after editing."
      : "Selected UI element context from the embedded browser preview:";
  return [heading, "", "```json", JSON.stringify(compactContext(context), null, 2), "```"].join(
    "\n",
  );
}

export function appendBrowserPreviewContextsToPrompt(
  prompt: string,
  contexts: ReadonlyArray<BrowserPreviewContextDraft>,
): string {
  const trimmedPrompt = prompt.trim();
  const contextBlocks = contexts.map((context) =>
    formatBrowserPreviewContextForPrompt(context.context, context.mode),
  );
  if (contextBlocks.length === 0) {
    return trimmedPrompt;
  }
  return [trimmedPrompt, ...contextBlocks].filter((block) => block.length > 0).join("\n\n");
}

export function previewContextLabel(context: BrowserPreviewElementContext): string {
  const name = context.accessibleName || context.text || context.attributes.id || context.domPath;
  return `${context.tagName}${name ? `: ${name.slice(0, 80)}` : ""}`;
}
