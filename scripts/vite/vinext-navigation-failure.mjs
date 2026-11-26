// Vinext beta.5's public router exposes no transport failure callback and
// hard-navigates on RSC failures. Let the pending app view handle that failure
// while leaving Vinext's redirect, compatibility and history paths intact.
export function vinextNavigationFailure() {
  return {
    name: "hkb:vinext-navigation-failure",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/vinext/dist/server/app-browser-entry.js")) return;
      const response = 'const navContentType = navResponse.headers.get("content-type")';
      const fallback = 'if (!isPageUnloading) console.error("[vinext] RSC navigation error:", error);';
      if (!code.includes(response) || !code.includes(fallback)) {
        this.error("Recheck RSC transport failure handling for the installed Vinext version.");
      }
      const offerFailure = `!window.dispatchEvent(new CustomEvent("hkb:route-failed", {
          detail: href, cancelable: true
        }))`;
      const dismissScrollIntent = "consumeAppRouterScrollIntent(scrollIntent ?? null); clearAppNavigationFailureTarget(href);";
      return code.replace(response, `if (navResponse.status >= 500 && ${offerFailure}) {
          navResponse.body?.cancel().catch(() => {});
          ${dismissScrollIntent}
          return;
        }
        ${response}`).replace(fallback, `if (${offerFailure}) {
          ${dismissScrollIntent}
          return;
        }
        ${fallback}`);
    },
  };
}
