import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { TopBar } from "./components/TopBar";
import { Toolbar } from "./components/Toolbar";
import { Stage } from "./components/Stage";
import { Properties } from "./components/Properties";
import { Timeline } from "./components/Timeline";
import { StartOverlay } from "./components/StartOverlay";
import { ExportModal } from "./components/ExportModal";
import { useConfirm } from "./components/ConfirmDialog";
import { useEditor } from "./state/EditorContext";
import type { Tool } from "./types";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  t: "text",
  b: "brush",
  r: "rect",
  e: "ellipse",
  c: "crop",
};

function isEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

export function App() {
  const {
    dispatch,
    resetProject,
    exportMedia,
    undo,
    redo,
    deleteSelected,
    bringForward,
    sendBackward,
    togglePlay,
  } = useEditor();
  const { confirm } = useConfirm();

  const [panels, setPanels] = useState({ left: 240, right: 280, bottom: 172 });

  // Drag a splitter to resize the toolbar, properties panel or timeline.
  const beginResize = (kind: "left" | "right" | "bottom") => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...panels };
    el.classList.add("dragging");
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (kind === "left") {
        const w = Math.max(160, Math.min(560, start.left + (ev.clientX - startX)));
        setPanels((p) => ({ ...p, left: w }));
      } else if (kind === "right") {
        const w = Math.max(220, Math.min(640, start.right - (ev.clientX - startX)));
        setPanels((p) => ({ ...p, right: w }));
      } else {
        const max = Math.round(window.innerHeight * 0.75);
        const h = Math.max(110, Math.min(max, start.bottom - (ev.clientY - startY)));
        setPanels((p) => ({ ...p, bottom: h }));
      }
    };
    const onUp = () => {
      el.classList.remove("dragging");
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onRestart = useCallback(async () => {
    const ok = await confirm({
      title: "Restart project?",
      message: "All changes will be lost. This cannot be undone.",
      confirmLabel: "Restart",
    });
    if (ok) resetProject();
  }, [confirm, resetProject]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void exportMedia();
        return;
      }
      if (mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        if (e.key === "]") bringForward();
        else sendBackward();
        return;
      }
      if (mod || isEditingTarget(e.target)) return;
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "Escape") {
        dispatch({ type: "selectObject", id: null });
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) dispatch({ type: "setActiveTool", tool });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, exportMedia, undo, redo, deleteSelected, bringForward, sendBackward, togglePlay]);

  return (
    <div id="app">
      <TopBar onRestart={() => void onRestart()} />
      <main
        className="layout"
        style={
          {
            "--panel-left": `${panels.left}px`,
            "--panel-right": `${panels.right}px`,
            "--panel-bottom": `${panels.bottom}px`,
          } as CSSProperties
        }
      >
        <Toolbar />
        <div
          className="splitter splitter-v splitter-left"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={beginResize("left")}
        />
        <Stage />
        <div
          className="splitter splitter-v splitter-right"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={beginResize("right")}
        />
        <Properties />
        <div
          className="splitter splitter-h splitter-bottom"
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={beginResize("bottom")}
        />
        <Timeline />
      </main>
      <StartOverlay />
      <ExportModal />
    </div>
  );
}
