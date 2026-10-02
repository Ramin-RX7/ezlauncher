import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import "../i18n";

// `findBy…`/`waitFor` give up after 1 s by default. A file's first render can take
// longer on a busy machine (a full run in parallel, a debugger attached), which
// failed tests at random; a real failure still fails, only later.
configure({ asyncUtilTimeout: 5000 });

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
