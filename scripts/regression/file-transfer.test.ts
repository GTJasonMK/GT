import assert from "node:assert/strict";
import test from "node:test";
import { importGraphFromFile, pickLocalFile } from "../../src/services/graphFileTransferCore.ts";

test("importGraphFromFile returns cancelled when tauri file dialog is dismissed", async () => {
  const result = await importGraphFromFile({
    isTauri: () => true,
    openFileDialog: async () => null,
    readTextFile: async () => {
      throw new Error("should not read");
    },
    pickLocalFile: async () => {
      throw new Error("should not use web picker");
    },
  });

  assert.deepEqual(result, { status: "cancelled" });
});

test("importGraphFromFile returns invalid for unsupported contents", async () => {
  const result = await importGraphFromFile({
    isTauri: () => true,
    openFileDialog: async () => "/tmp/invalid.json",
    readTextFile: async () => "{\"invalid\":true}",
    pickLocalFile: async () => {
      throw new Error("should not use web picker");
    },
  });

  assert.deepEqual(result, { status: "invalid" });
});

test("pickLocalFile resolves null when browser file dialog is cancelled", async () => {
  let focusHandler: (() => void) | null = null;
  const input = {
    type: "",
    accept: "",
    files: null,
    clickCalled: false,
    onchange: null as null | (() => void),
    addEventListener: (_name: string, _handler: () => void) => {},
    remove: () => {},
    click() {
      this.clickCalled = true;
    },
  };

  const resultPromise = pickLocalFile(".json", {
    createInput: () => input,
    appendInput: () => {},
    addWindowFocusListener: (handler) => {
      focusHandler = handler;
    },
    removeWindowFocusListener: () => {
      focusHandler = null;
    },
    schedule: (callback) => {
      callback();
      return 0;
    },
  });

  focusHandler?.();
  const result = await resultPromise;

  assert.equal(input.clickCalled, true);
  assert.equal(result, null);
});
