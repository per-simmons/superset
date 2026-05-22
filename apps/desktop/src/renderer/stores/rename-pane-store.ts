import { create } from "zustand";

interface RenamePaneState {
	renamingPaneId: string | null;
}

interface RenamePaneActions {
	startRenamingPane: (paneId: string) => void;
	stopRenamingPane: () => void;
}

export const useRenamePaneStore = create<RenamePaneState & RenamePaneActions>(
	(set) => ({
		renamingPaneId: null,
		startRenamingPane: (paneId) => set({ renamingPaneId: paneId }),
		stopRenamingPane: () => set({ renamingPaneId: null }),
	}),
);
