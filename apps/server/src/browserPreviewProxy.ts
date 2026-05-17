import * as Data from "effect/Data";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const PREVIEW_BRIDGE_SCRIPT = String.raw`
(() => {
  if (window.__SNOCODE_BROWSER_PREVIEW_BRIDGE__) return;
  window.__SNOCODE_BROWSER_PREVIEW_BRIDGE__ = true;

  const SOURCE = "snocode-browser-preview";
  const HOST_SOURCE = "snocode-browser-preview-host";
  let selectMode = false;
  let hovered = null;
  let selected = null;

  const style = document.createElement("style");
  style.textContent = [
    "[data-snocode-preview-hover='true']{outline:2px solid #38bdf8!important;outline-offset:2px!important;cursor:crosshair!important}",
    "[data-snocode-preview-selected='true']{outline:2px solid #f97316!important;outline-offset:2px!important}"
  ].join("");
  document.documentElement.appendChild(style);

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function textOf(element) {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function accessibleName(element) {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text.slice(0, 250);
    }
    return (
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      ""
    ).trim().slice(0, 250);
  }

  function domPath(element) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      const parent = node.parentElement;
      const tag = node.tagName.toLowerCase();
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const index = siblings.indexOf(node) + 1;
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      node = parent;
    }
    return ["html", ...parts].join(" > ");
  }

  function candidateSelectors(element) {
    const selectors = [];
    const tag = element.tagName.toLowerCase();
    const id = element.id?.trim();
    if (id) selectors.push("#" + cssEscape(id));
    for (const attr of ["data-testid", "data-test", "data-cy", "name", "aria-label", "role"]) {
      const value = element.getAttribute(attr);
      if (value) selectors.push(tag + "[" + attr + "=\"" + String(value).replace(/"/g, '\\"') + "\"]");
    }
    const classNames = Array.from(element.classList || []).filter(Boolean).slice(0, 4);
    if (classNames.length > 0) selectors.push(tag + "." + classNames.map(cssEscape).join("."));
    selectors.push(domPath(element));
    return Array.from(new Set(selectors)).slice(0, 8);
  }

  function attrs(element) {
    const out = {};
    for (const attr of Array.from(element.attributes || [])) {
      if (
        attr.name === "style" ||
        attr.name.startsWith("data-snocode-preview-") ||
        attr.value.length > 300
      ) {
        continue;
      }
      if (
        attr.name === "id" ||
        attr.name === "class" ||
        attr.name === "role" ||
        attr.name === "name" ||
        attr.name === "type" ||
        attr.name.startsWith("aria-") ||
        attr.name.startsWith("data-")
      ) {
        out[attr.name] = attr.value;
      }
    }
    return out;
  }

  function contextFor(element) {
    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    const parent = element.parentElement;
    return {
      capturedAt: new Date().toISOString(),
      pageUrl: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      tagName: element.tagName.toLowerCase(),
      text: textOf(element),
      accessibleName: accessibleName(element),
      role: element.getAttribute("role") || "",
      attributes: attrs(element),
      boundingRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left)
      },
      computedStyle: {
        display: computed.display,
        position: computed.position,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        margin: computed.margin,
        padding: computed.padding
      },
      domPath: domPath(element),
      selectorCandidates: candidateSelectors(element),
      nearbyText: {
        parent: parent ? textOf(parent).slice(0, 700) : "",
        previous: element.previousElementSibling ? textOf(element.previousElementSibling).slice(0, 250) : "",
        next: element.nextElementSibling ? textOf(element.nextElementSibling).slice(0, 250) : ""
      }
    };
  }

  function clearHover() {
    if (hovered) hovered.removeAttribute("data-snocode-preview-hover");
    hovered = null;
  }

  function setSelected(element) {
    if (selected) selected.removeAttribute("data-snocode-preview-selected");
    selected = element;
    selected.setAttribute("data-snocode-preview-selected", "true");
    window.parent.postMessage({ source: SOURCE, type: "element-selected", payload: contextFor(element) }, "*");
  }

  function firstMatchingSelector(selectors) {
    for (const selector of selectors || []) {
      try {
        const element = document.querySelector(selector);
        if (element) return { selector, element };
      } catch {
      }
    }
    return null;
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== HOST_SOURCE) return;
    if (data.type === "set-select-mode") {
      selectMode = Boolean(data.enabled);
      if (!selectMode) clearHover();
    }
    if (data.type === "verify-selector") {
      const match = firstMatchingSelector(data.selectors);
      window.parent.postMessage({
        source: SOURCE,
        type: "selector-verified",
        payload: match
          ? { found: true, selector: match.selector, context: contextFor(match.element) }
          : { found: false }
      }, "*");
    }
  });

  document.addEventListener("mouseover", (event) => {
    if (!selectMode) return;
    const target = event.target;
    if (!(target instanceof Element) || target === document.documentElement || target === document.body) return;
    if (hovered === target) return;
    clearHover();
    hovered = target;
    hovered.setAttribute("data-snocode-preview-hover", "true");
  }, true);

  document.addEventListener("mouseout", () => {
    if (!selectMode) return;
    clearHover();
  }, true);

  document.addEventListener("click", (event) => {
    if (!selectMode) return;
    const target = event.target;
    if (!(target instanceof Element) || target === document.documentElement || target === document.body) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(target);
  }, true);

  window.parent.postMessage({ source: SOURCE, type: "ready", payload: { pageUrl: location.href, title: document.title } }, "*");
})();
`;

export class BrowserPreviewTargetError extends Data.TaggedError("BrowserPreviewTargetError")<{
  readonly message: string;
}> {}

export class BrowserPreviewFetchError extends Data.TaggedError("BrowserPreviewFetchError")<{
  readonly target: string;
  readonly cause: unknown;
}> {}

export type BrowserPreviewTargetParseResult =
  | {
      readonly ok: true;
      readonly target: URL;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 127
  );
}

function isAllowedPreviewHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return LOOPBACK_HOSTNAMES.has(normalized) || isPrivateIpv4(normalized);
}

export function parseBrowserPreviewTarget(rawTarget: string | null): URL {
  if (!rawTarget) {
    throw new BrowserPreviewTargetError({ message: "Missing preview target URL." });
  }

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new BrowserPreviewTargetError({ message: "Invalid preview target URL." });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new BrowserPreviewTargetError({ message: "Preview target must use http or https." });
  }
  if (target.username || target.password) {
    throw new BrowserPreviewTargetError({ message: "Preview target credentials are not allowed." });
  }
  if (!isAllowedPreviewHostname(target.hostname)) {
    throw new BrowserPreviewTargetError({
      message: "Preview target must be a loopback or private dev host.",
    });
  }

  return target;
}

export function tryParseBrowserPreviewTarget(
  rawTarget: string | null,
): BrowserPreviewTargetParseResult {
  try {
    return { ok: true, target: parseBrowserPreviewTarget(rawTarget) };
  } catch (cause) {
    const message =
      cause instanceof BrowserPreviewTargetError ? cause.message : "Invalid preview target.";
    return { ok: false, message };
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function insertBeforeClosingTag(html: string, closingTag: string, insertion: string): string {
  const index = html.toLowerCase().lastIndexOf(closingTag);
  if (index === -1) {
    return `${html}${insertion}`;
  }
  return `${html.slice(0, index)}${insertion}${html.slice(index)}`;
}

export function injectBrowserPreviewBridge(html: string, target: URL): string {
  const baseHref = escapeHtmlAttribute(new URL(".", target).href);
  const baseTag = /<base\b/i.test(html) ? "" : `<base href="${baseHref}">`;
  const scriptTag = `<script data-snocode-browser-preview-bridge>${PREVIEW_BRIDGE_SCRIPT}</script>`;
  const withBase = baseTag ? insertBeforeClosingTag(html, "</head>", baseTag) : html;
  return insertBeforeClosingTag(withBase, "</body>", scriptTag);
}

export function isHtmlContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes("text/html") ?? false;
}
