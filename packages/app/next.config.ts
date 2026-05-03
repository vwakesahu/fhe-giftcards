import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // cofhejs/web ships a wasm-bindgen-rayon WASM (`tfhe`) that webpack's dev
  // mode doesn't handle correctly with its defaults — it falls through to an
  // unintended parser that misreads the public-key length prefix and aborts
  // with `Custom("invalid value: integer ..., expected usize")` at init.
  // Enabling asyncWebAssembly + topLevelAwait routes the import through
  // webpack's real WASM loader, matching what the production build does.
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      topLevelAwait: true,
    };
    return config;
  },
  // tfhe's WASM is built against `WebAssembly.Memory({shared: true})`, which
  // the browser only hands out when the page is cross-origin isolated. Without
  // these headers, SharedArrayBuffer is `undefined`, the WASM falls back to
  // non-shared memory, and its linear-memory layout doesn't match what the
  // module was compiled for — every deserialize then reads at the wrong offset
  // ("Error serializing public key" with bytes pulled from inside the type-
  // name string). COEP `credentialless` (vs. `require-corp`) keeps SAB enabled
  // without forcing every cross-origin resource — RainbowKit/WalletConnect
  // popups, wallet icons — to send `Cross-Origin-Resource-Policy`.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
