"use client";

import { useEffect, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Position } from "monaco-editor";
import { useStore } from "@/lib/store";
import { STRATEGY_API } from "@/lib/docs";

export default function EditorPane() {
  const active = useStore((s) => s.active());
  const updateCode = useStore((s) => s.updateCode);
  const persistActive = useStore((s) => s.persistActive);
  const extractParams = useStore((s) => s.extractParams);
  const runError = useStore((s) => s.runError);
  const optimizationState = useStore((s) => s.optimizationState);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    monaco.editor.defineTheme("quantdeck", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: "e8e4da" },
        { token: "keyword", foreground: "7fb2e5" },
        { token: "string", foreground: "c8b88a" },
        { token: "number", foreground: "d9a441" },
        { token: "comment", foreground: "5e6a7d", fontStyle: "italic" },
      ],
      colors: {
        "editor.background": "#131a26",
        "editor.foreground": "#e8e4da",
        "editor.lineHighlightBackground": "#1a2332",
        "editor.lineHighlightBorder": "#00000000",
        "editorLineNumber.foreground": "#4a5568",
        "editorLineNumber.activeForeground": "#9aa3b2",
        "editorGutter.background": "#131a26",
        "editorIndentGuide.background1": "#222d40",
        "editor.selectionBackground": "#d9a44133",
        "editorCursor.foreground": "#d9a441",
        "editorWidget.background": "#222d40",
        "editorWidget.border": "#2a3648",
        "editorSuggestWidget.selectedBackground": "#2a3648",
      },
    });
    monaco.editor.setTheme("quantdeck");
    monaco.languages.registerCompletionItemProvider("python", {
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        return { suggestions: STRATEGY_API.map((api) => ({
          label: api.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: api.name,
          detail: api.signature,
          documentation: api.description,
          range,
        })) };
      },
    });
    monaco.languages.registerHoverProvider("python", {
      provideHover: (model: editor.ITextModel, position: Position) => {
        const word = model.getWordAtPosition(position);
        const api = word && STRATEGY_API.find((entry) => entry.name === word.word);
        return api ? { contents: [{ value: `**${api.signature}**` }, { value: api.description }] } : null;
      },
    });
  };

  // python error markers: red squiggle + gutter marker + line tint
  useEffect(() => {
    const monaco = monacoRef.current;
    const ed = editorRef.current;
    if (!monaco || !ed) return;
    const model = ed.getModel();
    if (!model) return;
    decorationsRef.current?.clear();
    if (runError?.lineNumber) {
      const line = Math.min(runError.lineNumber, model.getLineCount());
      monaco.editor.setModelMarkers(model, "qd-python", [
        {
          severity: monaco.MarkerSeverity.Error,
          message: runError.message,
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        },
      ]);
      decorationsRef.current = ed.createDecorationsCollection([
        {
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "qd-error-line",
            glyphMarginClassName: "qd-error-glyph",
          },
        },
      ]);
      ed.revealLineInCenterIfOutsideViewport(line);
    } else {
      monaco.editor.setModelMarkers(model, "qd-python", []);
    }
  }, [runError]);

  if (!active) return null;

  return (
    <Editor
      height="100%"
      language="python"
      theme="quantdeck"
      path={`${active.id}.py`}
      value={active.code}
      onMount={onMount}
      onChange={(value) => {
        updateCode(value ?? "");
        if (debounceRef.current) clearTimeout(debounceRef.current);
        // autosave + AST param re-extraction, debounced 1s
        debounceRef.current = setTimeout(() => {
          persistActive();
          extractParams();
        }, 1000);
      }}
      options={{
        fontFamily: "var(--font-plex-mono), IBM Plex Mono, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        glyphMargin: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: "all",
        padding: { top: 12 },
        tabSize: 4,
        insertSpaces: true,
        wordWrap: "off",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        smoothScrolling: true,
        contextmenu: true,
        readOnly: optimizationState !== "idle",
        automaticLayout: true,
      }}
    />
  );
}
