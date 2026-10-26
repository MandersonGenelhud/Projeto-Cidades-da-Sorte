import type { Files } from "./types";

const isExternal = (url: string) => /^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("data:");
const normalize = (url: string) => url.replace(/^\.\//, "").replace(/^\//, "");

/**
 * Turns the generated files into one HTML document for the sandboxed preview
 * iframe: local stylesheets and scripts referenced by index.html are inlined.
 */
export function buildPreviewHtml(files: Files): string | null {
  const index = files["index.html"];
  if (index === undefined) return null;

  return index
    .replace(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi, (tag, href: string) => {
      if (!/rel=["']stylesheet["']/i.test(tag) || isExternal(href)) return tag;
      const css = files[normalize(href)];
      return css === undefined ? tag : `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
    })
    .replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
      if (isExternal(src)) return tag;
      const js = files[normalize(src)];
      if (js === undefined) return tag;
      const attrs = `${before}${after}`.replace(/\s+/g, " ").trim();
      return `<script${attrs ? ` ${attrs}` : ""}>${js.replace(/<\/script/gi, "<\\/script")}</script>`;
    });
}
