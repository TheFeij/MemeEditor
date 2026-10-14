import { useCallback, useEffect } from "react";
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
      <main className="layout">
        <Toolbar />
        <Stage />
        <Properties />
        <Timeline />
      </main>
      <StartOverlay />
      <ExportModal />
    </div>
  );
}
