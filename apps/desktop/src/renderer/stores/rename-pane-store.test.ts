import { beforeEach, describe, expect, it } from "bun:test";
import { useRenamePaneStore } from "./rename-pane-store";

describe("useRenamePaneStore", () => {
	beforeEach(() => {
		useRenamePaneStore.setState({ renamingPaneId: null });
	});

	it("starts with renamingPaneId = null", () => {
		expect(useRenamePaneStore.getState().renamingPaneId).toBeNull();
	});

	it("startRenamingPane sets renamingPaneId", () => {
		useRenamePaneStore.getState().startRenamingPane("pane-1");
		expect(useRenamePaneStore.getState().renamingPaneId).toBe("pane-1");
	});

	it("stopRenamingPane clears renamingPaneId", () => {
		useRenamePaneStore.getState().startRenamingPane("pane-1");
		useRenamePaneStore.getState().stopRenamingPane();
		expect(useRenamePaneStore.getState().renamingPaneId).toBeNull();
	});

	it("starting on a new pane replaces the old one (no overlap state)", () => {
		useRenamePaneStore.getState().startRenamingPane("pane-1");
		useRenamePaneStore.getState().startRenamingPane("pane-2");
		expect(useRenamePaneStore.getState().renamingPaneId).toBe("pane-2");
	});
});
