import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Inject a Content-Security-Policy tailored to each mode: the dev server needs
// inline/eval for React Fast Refresh and a websocket for HMR, while the shipped
// renderer only loads its own bundled files plus data:/blob: media.
function cspPlugin(): Plugin {
  return {
    name: "meme-csp",
    transformIndexHtml(html, ctx) {
      const dev = ctx.server != null;
      const csp = dev
        ? "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: http: https: data: blob:"
        : "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' data: blob:";
      return html.replace(
        "</head>",
        `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  </head>`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
