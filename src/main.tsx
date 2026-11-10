import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/onest/wght.css";
import "@fontsource/marcellus/latin-400.css";
import "./styles.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
