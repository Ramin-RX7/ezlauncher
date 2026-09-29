import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "../i18n";

// jsdom has no ResizeObserver; Radix primitives (e.g. Checkbox) observe their size.
if (!("ResizeObserver" in globalThis))
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  });

afterEach(() => {
  cleanup();
});
