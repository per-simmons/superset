import type { TerminalPreset } from "@superset/local-db";
import { FEATURE_FLAGS } from "@superset/shared/constants";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useFeatureFlagEnabled } from "posthog-js/react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { usePresets } from "renderer/react-query/presets";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useAppHotkey } from "renderer/stores/hotkeys";
import { useRenamePaneStore } from "renderer/stores/rename-pane-store";
import { useTabsStore } from "renderer/stores/tabs/store";
import { useTabsWithPresets } from "renderer/stores/tabs/useTabsWithPresets";
import {
	isLastPaneInTab,
	resolveActiveTabIdForWorkspace,
	resolveRenameTarget,
} from "renderer/stores/tabs/utils";
import {
	DEFAULT_SHOW_PRESETS_BAR,
	DEFAULT_USE_COMPACT_TERMINAL_ADD_BUTTON,
} from "shared/constants";
import { type ActivePaneStatus, pickHigherStatus } from "shared/tabs-types";
import { AddTabButton } from "./components/AddTabButton";
import { GroupItem } from "./GroupItem";

const NO_WORKSPACE_MATCH = "__no_workspace__";

export function GroupStrip() {
	const { workspaceId: activeWorkspaceId } = useParams({ strict: false });

	const allTabs = useTabsStore((s) => s.tabs);
	const panes = useTabsStore((s) => s.panes);
	const activeTabIds = useTabsStore((s) => s.activeTabIds);
	const tabHistoryStacks = useTabsStore((s) => s.tabHistoryStacks);
	const { addTab, openPreset } = useTabsWithPresets();
	const addChatMastraTab = useTabsStore((s) => s.addChatMastraTab);
	const addBrowserTab = useTabsStore((s) => s.addBrowserTab);
	const renameTab = useTabsStore((s) => s.renameTab);
	const removeTab = useTabsStore((s) => s.removeTab);
	const setActiveTab = useTabsStore((s) => s.setActiveTab);
	const movePaneToTab = useTabsStore((s) => s.movePaneToTab);
	const movePaneToNewTab = useTabsStore((s) => s.movePaneToNewTab);
	const reorderTabs = useTabsStore((s) => s.reorderTabs);

	const setTabAutoTitle = useTabsStore((s) => s.setTabAutoTitle);
	const { presets } = usePresets();
	const navigate = useNavigate();

	const addFileViewerPane = useTabsStore((s) => s.addFileViewerPane);
	const hasAiChat = useFeatureFlagEnabled(FEATURE_FLAGS.AI_CHAT);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const tabsTrackRef = useRef<HTMLDivElement>(null);
	const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
	const utils = electronTrpc.useUtils();
	const { data: showPresetsBar } =
		electronTrpc.settings.getShowPresetsBar.useQuery();
	const { data: useCompactTerminalAddButton } =
		electronTrpc.settings.getUseCompactTerminalAddButton.useQuery();
	const setShowPresetsBar = electronTrpc.settings.setShowPresetsBar.useMutation(
		{
			onMutate: async ({ enabled }) => {
				await utils.settings.getShowPresetsBar.cancel();
				const previous = utils.settings.getShowPresetsBar.getData();
				utils.settings.getShowPresetsBar.setData(undefined, enabled);
				return { previous };
			},
			onError: (_err, _vars, context) => {
				if (context?.previous !== undefined) {
					utils.settings.getShowPresetsBar.setData(undefined, context.previous);
				}
			},
			onSettled: () => {
				utils.settings.getShowPresetsBar.invalidate();
			},
		},
	);
	const setUseCompactTerminalAddButton =
		electronTrpc.settings.setUseCompactTerminalAddButton.useMutation({
			onMutate: async ({ enabled }) => {
				await utils.settings.getUseCompactTerminalAddButton.cancel();
				const previous =
					utils.settings.getUseCompactTerminalAddButton.getData();
				utils.settings.getUseCompactTerminalAddButton.setData(
					undefined,
					enabled,
				);
				return { previous };
			},
			onError: (_err, _vars, context) => {
				if (context?.previous !== undefined) {
					utils.settings.getUseCompactTerminalAddButton.setData(
						undefined,
						context.previous,
					);
				}
			},
			onSettled: () => {
				utils.settings.getUseCompactTerminalAddButton.invalidate();
			},
		});

	const tabs = useMemo(
		() =>
			activeWorkspaceId
				? allTabs.filter((tab) => tab.workspaceId === activeWorkspaceId)
				: [],
		[activeWorkspaceId, allTabs],
	);

	const activeTabId = useMemo(() => {
		if (!activeWorkspaceId) return null;
		return resolveActiveTabIdForWorkspace({
			workspaceId: activeWorkspaceId,
			tabs: allTabs,
			activeTabIds,
			tabHistoryStacks,
		});
	}, [activeWorkspaceId, activeTabIds, allTabs, tabHistoryStacks]);

	// Cmd+I rename: if active tab is split (>1 pane) and a terminal sub-pane
	// has focus, rename that pane. Otherwise rename the top-level tab.
	const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
	useAppHotkey(
		"RENAME_TAB",
		() => {
			const state = useTabsStore.getState();
			const focusedPaneId = activeTabId
				? state.focusedPaneIds[activeTabId]
				: undefined;
			const target = resolveRenameTarget({
				activeTabId,
				panesForTab: activeTabId ? state.getPanesForTab(activeTabId) : [],
				focusedPane: focusedPaneId ? state.panes[focusedPaneId] : undefined,
			});
			if (!target) return;
			if (target.type === "pane") {
				useRenamePaneStore.getState().startRenamingPane(target.paneId);
			} else {
				setRenamingTabId(target.tabId);
			}
		},
		{ preventDefault: true },
		[activeTabId],
	);

	// Compute aggregate status per tab using shared priority logic
	const tabStatusMap = useMemo(() => {
		const result = new Map<string, ActivePaneStatus>();
		for (const pane of Object.values(panes)) {
			if (!pane.status || pane.status === "idle") continue;
			const higher = pickHigherStatus(result.get(pane.tabId), pane.status);
			if (higher !== "idle") {
				result.set(pane.tabId, higher);
			}
		}
		return result;
	}, [panes]);

	// Sync Electric session titles → tab names for all Mastra chat tabs in this workspace
	const chatPaneSessionMap = useMemo(() => {
		const map = new Map<string, string>(); // sessionId → tabId
		for (const pane of Object.values(panes)) {
			if (pane.type === "chat-mastra" && pane.chatMastra?.sessionId) {
				const tab = tabs.find((t) => t.id === pane.tabId);
				if (tab) map.set(pane.chatMastra.sessionId, tab.id);
			}
		}
		return map;
	}, [panes, tabs]);
	const shouldSyncChatTitles =
		Boolean(activeWorkspaceId) && chatPaneSessionMap.size > 0;
	const workspaceIdForChatTitleSync = shouldSyncChatTitles
		? activeWorkspaceId
		: NO_WORKSPACE_MATCH;

	const collections = useCollections();
	const { data: chatSessions } = useLiveQuery(
		(q) =>
			q
				.from({ chatSessions: collections.chatSessions })
				.where(({ chatSessions }) =>
					eq(chatSessions.workspaceId, workspaceIdForChatTitleSync),
				)
				.select(({ chatSessions }) => ({
					id: chatSessions.id,
					title: chatSessions.title,
				})),
		[collections.chatSessions, workspaceIdForChatTitleSync],
	);

	useEffect(() => {
		if (!shouldSyncChatTitles) return;
		if (!chatSessions) return;
		for (const session of chatSessions) {
			const tabId = chatPaneSessionMap.get(session.id);
			if (tabId) {
				setTabAutoTitle(tabId, session.title || "New Chat");
			}
		}
	}, [chatSessions, chatPaneSessionMap, setTabAutoTitle, shouldSyncChatTitles]);

	// Workspace query + note/session mutations (must be before handlers that use them)
	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: activeWorkspaceId! },
		{ enabled: !!activeWorkspaceId },
	);
	const createNoteMutation = electronTrpc.filesystem.createNote.useMutation();
	const logSessionMutation = electronTrpc.filesystem.logSession.useMutation();

	const logSession = useCallback(
		(tabName: string, action: "created" | "renamed" | "closed", extra?: { oldName?: string; createdAt?: string }) => {
			if (!workspace?.project?.mainRepoPath) return;
			logSessionMutation.mutate({
				rootPath: workspace.project.mainRepoPath,
				tabName,
				action,
				...extra,
			});
		},
		[workspace?.project?.mainRepoPath, logSessionMutation],
	);

	const handleAddGroup = () => {
		if (!activeWorkspaceId) return;
		const result = addTab(activeWorkspaceId);
		if (result) {
			const tab = useTabsStore.getState().tabs.find((t) => t.id === result.tabId);
			if (tab) logSession(tab.name || "Terminal", "created");
		}
	};

	const handleAddChat = () => {
		if (!activeWorkspaceId) return;
		addChatMastraTab(activeWorkspaceId);
	};

	const handleAddBrowser = () => {
		if (!activeWorkspaceId) return;
		addBrowserTab(activeWorkspaceId);
	};

	const handleAddNote = useCallback(async () => {
		if (!activeWorkspaceId || !workspace?.project?.mainRepoPath) return;
		try {
			const result = await createNoteMutation.mutateAsync({
				rootPath: workspace.project.mainRepoPath,
			});
			addFileViewerPane(activeWorkspaceId, {
				filePath: result.relativePath,
				viewMode: "raw",
				isPinned: true,
				openInNewTab: true,
			});
		} catch (error) {
			console.error("[GroupStrip] Failed to create note:", error);
		}
	}, [activeWorkspaceId, workspace?.project?.mainRepoPath, createNoteMutation, addFileViewerPane]);

	const handleOpenPreset = useCallback(
		(preset: TerminalPreset) => {
			if (!activeWorkspaceId) return;
			openPreset(activeWorkspaceId, preset, { target: "active-tab" });
		},
		[activeWorkspaceId, openPreset],
	);

	const handleOpenPresetsSettings = useCallback(() => {
		navigate({ to: "/settings/presets" });
	}, [navigate]);

	const handleSelectGroup = (tabId: string) => {
		if (activeWorkspaceId) {
			setActiveTab(activeWorkspaceId, tabId);
		}
	};

	const handleCloseGroup = (tabId: string) => {
		const tab = tabs.find((t) => t.id === tabId);
		if (tab) {
			const created = new Date(tab.createdAt).toLocaleString("en-US", {
				month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
			});
			logSession(tab.userTitle || tab.name || "Terminal", "closed", { createdAt: created });
		}
		removeTab(tabId);
	};

	const handleRenameGroup = (tabId: string, newName: string) => {
		const tab = tabs.find((t) => t.id === tabId);
		const oldName = tab?.userTitle || tab?.name || "Terminal";
		const created = tab ? new Date(tab.createdAt).toLocaleString("en-US", {
			month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
		}) : undefined;
		renameTab(tabId, newName);
		logSession(newName, "renamed", { oldName, createdAt: created });
	};

	const handleReorderTabs = useCallback(
		(fromIndex: number, toIndex: number) => {
			if (activeWorkspaceId) {
				reorderTabs(activeWorkspaceId, fromIndex, toIndex);
			}
		},
		[activeWorkspaceId, reorderTabs],
	);

	const checkIsLastPaneInTab = useCallback((paneId: string) => {
		// Get fresh panes from store to avoid stale closure issues during drag-drop
		const freshPanes = useTabsStore.getState().panes;
		const pane = freshPanes[paneId];
		if (!pane) return true;
		return isLastPaneInTab(freshPanes, pane.tabId);
	}, []);

	const updateOverflow = useCallback(() => {
		const container = scrollContainerRef.current;
		const track = tabsTrackRef.current;
		if (!container || !track) return;
		setHasHorizontalOverflow(track.scrollWidth > container.clientWidth + 1);
	}, []);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		const track = tabsTrackRef.current;
		if (!container || !track) return;

		updateOverflow();
		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(container);
		resizeObserver.observe(track);
		window.addEventListener("resize", updateOverflow);

		return () => {
			resizeObserver.disconnect();
			window.removeEventListener("resize", updateOverflow);
		};
	}, [updateOverflow]);

	useEffect(() => {
		requestAnimationFrame(updateOverflow);
	}, [updateOverflow]);

	// Scroll the active tab into view when it changes (e.g. cmd+shift+]/[ cycle).
	// Without this, cycling past the visible window leaves the active tab off-screen
	// and the strip doesn't follow.
	useEffect(() => {
		if (!activeTabId) return;
		const container = scrollContainerRef.current;
		if (!container) return;
		const el = container.querySelector<HTMLElement>(
			`[data-tab-id="${activeTabId}"]`,
		);
		if (!el) return;
		el.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
			inline: "nearest",
		});
	}, [activeTabId]);

	const useCompactAddButton =
		useCompactTerminalAddButton ?? DEFAULT_USE_COMPACT_TERMINAL_ADD_BUTTON;

	const plusControl = (
		<AddTabButton
			hasAiChat={hasAiChat === true}
			useCompactAddButton={useCompactAddButton}
			showPresetsBar={showPresetsBar ?? DEFAULT_SHOW_PRESETS_BAR}
			presets={presets}
			onDropToNewTab={movePaneToNewTab}
			isLastPaneInTab={checkIsLastPaneInTab}
			onAddTerminal={handleAddGroup}
			onAddChat={handleAddChat}
			onAddBrowser={handleAddBrowser}
			onAddNote={handleAddNote}
			onOpenPreset={handleOpenPreset}
			onConfigurePresets={handleOpenPresetsSettings}
			onToggleShowPresetsBar={(enabled) =>
				setShowPresetsBar.mutate({ enabled })
			}
			onToggleCompactAddButton={(enabled) =>
				setUseCompactTerminalAddButton.mutate({ enabled })
			}
		/>
	);

	return (
		<div className="flex h-10 min-w-0 flex-1 items-stretch">
			<div
				ref={scrollContainerRef}
				className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
				style={{ scrollbarWidth: "none" }}
			>
				<div ref={tabsTrackRef} className="flex items-stretch">
					{tabs.length > 0 && (
						<div className="flex items-stretch h-full shrink-0">
							{tabs.map((tab, index) => {
								return (
									<div
										key={tab.id}
										data-tab-id={tab.id}
										className="h-full shrink-0"
										style={{ width: "160px" }}
									>
										<GroupItem
											tab={tab}
											index={index}
											isActive={tab.id === activeTabId}
											isRenaming={renamingTabId === tab.id}
											status={tabStatusMap.get(tab.id) ?? null}
											onSelect={() => handleSelectGroup(tab.id)}
											onClose={() => handleCloseGroup(tab.id)}
											onRename={(newName) => handleRenameGroup(tab.id, newName)}
											onRenameStarted={() => setRenamingTabId(null)}
											onPaneDrop={(paneId) => movePaneToTab(paneId, tab.id)}
											onReorder={handleReorderTabs}
										/>
									</div>
								);
							})}
						</div>
					)}
					{hasHorizontalOverflow ? (
						<div
							className={`h-full shrink-0 ${
								!useCompactAddButton
									? hasAiChat
										? "w-[220px]"
										: "w-[170px]"
									: "w-10"
							}`}
						/>
					) : (
						<div className="shrink-0">{plusControl}</div>
					)}
				</div>
			</div>
			{hasHorizontalOverflow && (
				<div className="shrink-0 bg-background/95 pr-1">{plusControl}</div>
			)}
		</div>
	);
}
