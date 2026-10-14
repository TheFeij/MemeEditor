import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/style.css";
import { App } from "./App";
import { ToastProvider } from "./components/Toasts";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { EditorProvider } from "./state/EditorContext";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <EditorProvider>
          <App />
        </EditorProvider>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
);
