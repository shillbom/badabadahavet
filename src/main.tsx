import { StrictMode, lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import { BootSplash } from "./components/Splash";

// App is lazy so the Firebase/Leaflet/page chunks load *after* first paint.
// Auth state lives in the Zustand store (no provider needed), so importing the
// store — and with it the ~618 KB Firebase chunk — happens inside this lazy
// boundary rather than eagerly here on the critical path.
const App = lazy(() => import("./App"));

// BootSplash is mounted eagerly (outside the lazy boundary) so it paints before
// the app chunk loads. It's pure CSS + a tiny signal, so it stays off the
// critical path, and it animates itself out once App reports ready.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <App />
      </Suspense>
      <BootSplash />
    </BrowserRouter>
  </StrictMode>,
);
