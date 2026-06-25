import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import PreviewPanel from "./PreviewPanel.jsx";

// Dev-only: ?preview=verdict renders the Part B verdict component in isolation
// against recorded fixtures. Lazy-loaded so it is code-split out of the prod
// bundle and never affects the live app.
const isVerdictPreview =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("preview") === "verdict";
const VerdictPreview = isVerdictPreview ? lazy(() => import("./dev/VerdictPreview.jsx")) : null;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isVerdictPreview ? (
      <Suspense fallback={null}>
        <VerdictPreview />
      </Suspense>
    ) : (
      <PreviewPanel />
    )}
  </StrictMode>
);
