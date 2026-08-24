import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import App from "./App";
import { initTheme } from "./ui/theme";

// Before render, so there is no flash of the wrong theme.
initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);








