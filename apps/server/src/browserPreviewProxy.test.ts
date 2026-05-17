import { describe, expect, it } from "vitest";

import {
  injectBrowserPreviewBridge,
  isHtmlContentType,
  parseBrowserPreviewTarget,
  tryParseBrowserPreviewTarget,
} from "./browserPreviewProxy.ts";

describe("browserPreviewProxy", () => {
  it("allows loopback and private dev targets", () => {
    expect(parseBrowserPreviewTarget("http://localhost:3000/path").href).toBe(
      "http://localhost:3000/path",
    );
    expect(parseBrowserPreviewTarget("http://192.168.1.5:5173/").href).toBe(
      "http://192.168.1.5:5173/",
    );
  });

  it("rejects unsafe preview targets", () => {
    expect(tryParseBrowserPreviewTarget(null)).toMatchObject({ ok: false });
    expect(tryParseBrowserPreviewTarget("file:///tmp/index.html")).toMatchObject({ ok: false });
    expect(tryParseBrowserPreviewTarget("https://example.com")).toMatchObject({ ok: false });
    expect(tryParseBrowserPreviewTarget("http://user:pass@localhost:3000")).toMatchObject({
      ok: false,
    });
  });

  it("injects the bridge script and base tag into html", () => {
    const html = "<html><head><title>App</title></head><body><main>Hello</main></body></html>";
    const injected = injectBrowserPreviewBridge(html, new URL("http://localhost:5173/nested/page"));

    expect(injected).toContain('<base href="http://localhost:5173/nested/">');
    expect(injected).toContain("data-snocode-browser-preview-bridge");
    expect(injected).toContain("snocode-browser-preview");
    expect(injected.indexOf("<base")).toBeLessThan(injected.indexOf("</head>"));
    expect(injected.indexOf("data-snocode-browser-preview-bridge")).toBeLessThan(
      injected.indexOf("</body>"),
    );
  });

  it("detects html content types", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/json")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });
});
