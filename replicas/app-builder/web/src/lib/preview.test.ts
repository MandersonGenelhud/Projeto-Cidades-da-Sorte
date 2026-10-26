import { describe, expect, it } from "vitest";
import { buildPreviewHtml } from "./preview";

describe("buildPreviewHtml", () => {
  it("inlines local stylesheets and scripts into index.html", () => {
    const html = buildPreviewHtml({
      "index.html":
        '<html><head><link rel="stylesheet" href="styles.css"></head><body><script src="./app.js"></script></body></html>',
      "styles.css": "body{color:red}",
      "app.js": "console.log('oi')",
    });
    expect(html).toContain("<style>body{color:red}</style>");
    expect(html).toContain("<script>console.log('oi')</script>");
    expect(html).not.toContain('href="styles.css"');
  });

  it("leaves external urls alone", () => {
    const html = buildPreviewHtml({
      "index.html": '<link rel="stylesheet" href="https://fonts.example/x.css"><script src="https://cdn.example/a.js"></script>',
    });
    expect(html).toContain('href="https://fonts.example/x.css"');
    expect(html).toContain('src="https://cdn.example/a.js"');
  });

  it("keeps a missing local file reference instead of crashing", () => {
    const html = buildPreviewHtml({ "index.html": '<script src="missing.js"></script>' });
    expect(html).toContain('src="missing.js"');
  });

  it("escapes a closing script tag inside inlined javascript", () => {
    const html = buildPreviewHtml({
      "index.html": '<script src="a.js"></script>',
      "a.js": 'const s = "</script>";',
    });
    expect(html).toContain('const s = "<\\/script>";');
  });

  it("returns null when there is no index.html", () => {
    expect(buildPreviewHtml({ "styles.css": "" })).toBeNull();
  });
});
