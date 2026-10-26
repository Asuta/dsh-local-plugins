window.__ModuleLoader__.load({
	id: "dsh-recent",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		/**
		* The rendered window after the operator reaches its end: one more page of
		* older sessions, never past the end of the history.
		* @param rendered - rows the section currently renders.
		* @param total - rows the derivation handed over.
		* @param page - rows one page holds.
		* @returns the window to render next.
		*/
		function growWindow(rendered, total, page = 20) {
			return Math.min(rendered + page, total);
		}
		/**
		* The pending-interaction kind the shell's rows mark, or undefined for a kind
		* no row offers.
		* @param kind - the pending interaction's domain kind.
		* @returns the markable kind.
		*/
		function marksWaiting(kind) {
			return kind === "approval" || kind === "plan-review" || kind === "question" ? kind : void 0;
		}
		/** Workspace display title of a session outside the registry: the path's last segment. */
		function pathLabel(cwd) {
			if (cwd === void 0 || cwd === "") return void 0;
			const base = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
			return base !== void 0 && base !== "" ? base : cwd;
		}
		/**
		* The session the main panel shows: the one holding the main view's local
		* reference count. Selection lives in that reference, not in the catalog, so
		* the list state carries no `current` field to read.
		* @param list - the session catalog.
		* @returns the main-view session id, or undefined while no session is selected.
		*/
		function currentSessionId(list) {
			return Object.values(list.byId).find((session) => (session.retainedBy.mainView ?? 0) > 0)?.id;
		}
		/**
		* Derive the 最近 rows: every session that holds history, across all
		* workspaces. Still-running sessions lead, then idle ones newest first. The list is complete — the section decides how much
		* of it to render at once, so scrolling can reach older sessions without the
		* derivation having thrown them away.
		* @param input - list, workspace registry, archive and pin sets, session status, and the localized ungrouped label.
		* @returns rows in render order.
		*/
		function deriveRecentRows(input) {
			const { list, workspaces, archivedSessionIds, pinnedSessionIds, status } = input;
			const archived = new Set(archivedSessionIds);
			const pinned = new Set(pinnedSessionIds);
			const current = currentSessionId(list);
			const workspaceOf = /* @__PURE__ */ new Map();
			for (const workspace of workspaces) for (const id of workspace.sessionIds) if (!workspaceOf.has(id)) workspaceOf.set(id, workspace.title);
			const rows = [];
			for (const id of list.ids) {
				const session = list.byId[id];
				if (session === void 0) continue;
				if (session.origin === "subagent") continue;
				if (session.blank) continue;
				if (archived.has(session.id)) continue;
				const live = status.get(session.id);
				rows.push({
					id: session.id,
					title: session.displayTitle,
					workspace: workspaceOf.get(session.id) ?? pathLabel(session.cwd) ?? input.ungroupedLabel,
					updatedAt: session.updatedAt,
					running: live?.running ?? session.running,
					pending: marksWaiting(live?.pendingInteraction?.kind),
					current: session.id === current,
					pinned: pinned.has(session.id)
				});
			}
			rows.sort((a, b) => {
				if (a.running !== b.running) return a.running ? -1 : 1;
				return b.updatedAt !== a.updatedAt ? b.updatedAt - a.updatedAt : a.id < b.id ? -1 : 1;
			});
			return rows;
		}
		//#endregion
		//#region src/client/workspaceFold.ts
		/** Class-name fragment of one workspace group section; the hash prefix is deployment-local. */
		const GROUP_SECTION_FRAGMENT = "_groupSection";
		/** Class-name fragment of the workspace browser's section header. */
		const SECTION_HEADER_FRAGMENT = "_sectionHeader";
		/** Class-name fragment of the header's label; the marker follows it. */
		const SECTION_LABEL_FRAGMENT = "_sectionLabel";
		/** Class-name fragment of the sidebar's foot area, the anchor for the list's owning column. */
		const FOOT_AREA_FRAGMENT = "_footArea";
		/**
		* The local-store key holding the list's unfolded choice. Expanding the list is
		* a setting rather than a look: the operator asked to see every project, and a
		* collapsed rail or a page reload must not quietly revoke that.
		*/
		const EXPANDED_STORE_KEY = "dsh-recent:view.workspacesExpanded";
		/**
		* Read the stored unfolded choice.
		* @param store - the storage to read (the browser's local store, or a test double).
		* @returns whether the list should render unfolded; anything but the exact on
		* value degrades to the folded default.
		*/
		function loadWorkspaceExpanded(store = window.localStorage) {
			try {
				return store.getItem(EXPANDED_STORE_KEY) === "1";
			} catch {
				return false;
			}
		}
		/**
		* Store the unfolded choice. A failed write (private mode, quota) is not an
		* error the section can act on — the choice still holds for this visit.
		* @param expanded - whether the list should render unfolded.
		* @param store - the storage to write (the browser's local store, or a test double).
		*/
		function saveWorkspaceExpanded(expanded, store = window.localStorage) {
			try {
				store.setItem(EXPANDED_STORE_KEY, expanded ? "1" : "0");
			} catch {}
		}
		/** Owner attribute on the injected toggle row (selecting by class would depend on our own hash). */
		const FOLD_ROW_ATTRIBUTE = "data-dsh-recent-fold";
		/** Owner attribute on the section header, carrying its collapse state. */
		const SECTION_COLLAPSED_ATTRIBUTE = "data-dsh-recent-section";
		/** Owner attribute on the injected chevron inside the section header. */
		const SECTION_CHEVRON_ATTRIBUTE = "data-dsh-recent-section-chevron";
		/** Owner attribute on the injected per-group session overflow row. */
		const SESSION_OVERFLOW_ATTRIBUTE = "data-dsh-recent-session-overflow";
		/**
		* Disclosure chevron geometry, copied from the shell's own thin chevron
		* (`IconChevronRightOutlineRegular`: 16-unit box, 1px stroke) so the sidebar
		* shows one arrow, not two glyph families. It points right while the list is
		* folded and takes a quarter turn to point down while the list is open — the
		* arrow carries the fold direction, the way the Codex sidebar's does.
		*/
		const CHEVRON_PATH = "M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4";
		/** The icon grid {@link CHEVRON_PATH} is drawn in (the shell's 16-unit box). */
		const CHEVRON_VIEW_BOX = "0 0 16 16";
		/** Stroke width of the shell's regular-tier outline icons. */
		const CHEVRON_STROKE_WIDTH = "1";
		/** Elements whose direct children are the workspace group sections, in render order. */
		function groupSections(container) {
			return [...container.children].filter((child) => child instanceof HTMLElement && child.className.includes(GROUP_SECTION_FRAGMENT));
		}
		/**
		* Resolve the workspace list container: the parent of the first rendered group
		* section. Resolving through a rendered group (rather than by class) keeps the
		* lookup correct for both the grouped tree and the flat list, which renders
		* sessions without group wrappers and therefore simply reports no container.
		* @param root - document subtree to search (the sidebar column, or document).
		* @returns the container element, or undefined before the browser mounts.
		*/
		function workspaceListContainer(root) {
			const container = root.querySelector(`[class*="${GROUP_SECTION_FRAGMENT}"]`)?.parentElement;
			return container instanceof HTMLElement ? container : void 0;
		}
		/**
		* Row-key prefix the shell writes on a group's own header row
		* (`data-row-key="workspace:<group key>"`), the one stable address a group
		* section carries: its classes are hashed and its markup is React's.
		*/
		const WORKSPACE_ROW_KEY = "workspace:";
		/**
		* Group key the shell renders on one group's header row: the Workspace id, or
		* {@link UNGROUPED_KEY} for the trailing bucket. The group's own header row is
		* its first addressable row, ahead of the session rows it holds.
		* @param group - one group section.
		* @returns the key, or undefined when the section carries no header row.
		*/
		function groupKey(group) {
			const key = group.querySelector(`[data-row-key^="${WORKSPACE_ROW_KEY}"]`)?.getAttribute("data-row-key");
			return key === null || key === void 0 ? void 0 : key.slice(10);
		}
		/** Row-key prefix the shell writes on one session row (`data-row-key="session:<id>"`). */
		const SESSION_ROW_KEY = "session:";
		/** Row-key prefix of the shell's own per-group overflow row (`overflow:<group key>`). */
		const OVERFLOW_ROW_KEY = "overflow:";
		/**
		* One row's slot: the outermost element holding it that is still a direct child
		* of the group section. The shell wraps every row in a hover-card slot
		* (`position:relative; display:block`) instead of rendering it as the group's
		* own child, and the group's child spacing rule gives that slot its own 2px
		* margin — so the slot, not the row inside it, is what a fold has to hide and
		* what an injected row has to sit beside. A row the group owns directly is its
		* own slot.
		* @param group - the group section owning the row.
		* @param row - one row inside that group.
		* @returns the direct child of the group holding the row.
		*/
		function rowSlot(group, row) {
			let slot = row;
			while (slot.parentElement !== null && slot.parentElement !== group) slot = slot.parentElement;
			return slot.parentElement === group ? slot : row;
		}
		/**
		* The session rows one group section holds, in render order. Rows are matched
		* wherever the shell wrapped them (its hover-card slot), but only the ones this
		* group owns: a nested group renders inside its parent, and its rows belong to
		* the nested group — as do the group header row and the shell's own overflow
		* row, which carry other row keys.
		* @param group - one group section.
		* @returns the session rows, in the order the shell rendered them.
		*/
		function sessionRows(group) {
			return [...group.querySelectorAll("[data-row-key]")].filter((row) => (row.getAttribute("data-row-key") ?? "").startsWith(SESSION_ROW_KEY) && row.closest(`[class*="${GROUP_SECTION_FRAGMENT}"]`) === group);
		}
		/**
		* The shell's own overflow row of one group, the control that raises the
		* shell's idle-session quota. It renders as a direct child of the group, after
		* the rows, and only while the shell itself holds sessions back.
		* @param group - one group section.
		* @returns the shell's overflow row, or undefined when the shell shows every row.
		*/
		function shellOverflowRow(group) {
			return [...group.children].find((child) => child instanceof HTMLElement && (child.getAttribute("data-row-key") ?? "").startsWith(OVERFLOW_ROW_KEY));
		}
		/** Session id of one session row, by the key {@link sessionRows} matched. */
		function sessionRowId(row) {
			return (row.getAttribute("data-row-key") ?? "").slice(8);
		}
		/**
		* Newest session time of every group, keyed the way {@link groupKey} reads
		* groups. Membership is the shell's own: each Workspace owns the sessions the
		* registry accounts to it, and every other session belongs to
		* {@link UNGROUPED_KEY}. Sessions without history do not count, so a group
		* holding none — and a group whose newest row is a blank provisional or an
		* archived session — ranks last, exactly as the 最近 list's own derivation
		* leaves them out.
		* @param input - session catalog, workspace registry, and the registry-global archive set.
		* @returns newest history time per group key; absent keys hold no history.
		*/
		function groupRecency(input) {
			const archived = new Set(input.archivedSessionIds);
			const owner = /* @__PURE__ */ new Map();
			for (const workspace of input.workspaces) for (const id of workspace.sessionIds) if (!owner.has(id)) owner.set(id, workspace.workspaceId);
			const newest = /* @__PURE__ */ new Map();
			for (const id of input.list.ids) {
				const session = input.list.byId[id];
				if (session === void 0) continue;
				if (session.origin === "subagent" || session.blank || archived.has(session.id)) continue;
				const key = owner.get(session.id) ?? "";
				const held = newest.get(key);
				if (held === void 0 || session.updatedAt > held) newest.set(key, session.updatedAt);
			}
			return newest;
		}
		/**
		* Split the group sections into the ones the fold keeps and the ones it holds
		* back: folded, the list keeps the `limit` groups with the newest history, and
		* the groups it has to leave out are the ones used longest ago — a group with
		* no history at all comes last, so it only fills a slot no group with history
		* claimed. Order is untouched: the kept groups are chosen, not moved, so the
		* column shows the shell's own order minus the losers. A list that already fits
		* the limit has nothing to choose between and keeps every group.
		* @param groups - group sections in render order.
		* @param limit - groups kept while folded.
		* @param expanded - whether the operator unfolded the list.
		* @param recency - newest history time of one group; undefined (or a non-finite
		* value) ranks last, and groups that tie keep their render order.
		* @returns visible and hidden groups (hidden is empty while expanded).
		*/
		function splitByRecency(groups, limit, expanded, recency) {
			if (expanded || groups.length <= limit) return {
				visible: [...groups],
				hidden: []
			};
			const ranked = groups.map((group, index) => {
				const at = recency(group);
				return {
					group,
					index,
					at: at !== void 0 && Number.isFinite(at) ? at : 0
				};
			}).sort((a, b) => b.at !== a.at ? b.at - a.at : a.index - b.index);
			const kept = new Set(ranked.slice(0, limit).map((entry) => entry.group));
			return {
				visible: groups.filter((group) => kept.has(group)),
				hidden: groups.filter((group) => !kept.has(group))
			};
		}
		/** Whether the element currently carries the fold's inline hide. */
		function isHidden(element) {
			return element.style.display === "none";
		}
		/** Hide or reveal one group section, writing only on a real change. */
		function setHidden(element, hidden) {
			if (isHidden(element) === hidden) return;
			element.style.display = hidden ? "none" : "";
		}
		/** The sidebar column owning the workspace list, for observer scope. */
		function sidebarColumn() {
			const column = document.querySelector(`[class*="${FOOT_AREA_FRAGMENT}"]`)?.parentElement;
			return column instanceof HTMLElement ? column : void 0;
		}
		/** Build the injected chevron (namespace-exact SVG, sized like the shell's 14px icons). */
		function createChevron() {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "14");
			svg.setAttribute("height", "14");
			svg.setAttribute("viewBox", CHEVRON_VIEW_BOX);
			svg.setAttribute("fill", "none");
			svg.setAttribute("aria-hidden", "true");
			svg.setAttribute(SECTION_CHEVRON_ATTRIBUTE, "");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", CHEVRON_PATH);
			path.setAttribute("stroke", "currentColor");
			path.setAttribute("stroke-width", CHEVRON_STROKE_WIDTH);
			svg.append(path);
			return svg;
		}
		/**
		* The layer currently owning the document's injected controls. The plugin's
		* client half can mount more than once per page — a reload of the client
		* bundle (client HMR), a shell remount, a slot rendered twice — and each mount
		* builds its own layer with its own chevron and fold row. The shell knows
		* nothing about either: it never removes a node it did not render, so a layer
		* that goes away without taking its nodes with it (its observer disconnected,
		* its disposer already run, or a write queued before disposal) leaves a second
		* row and a second chevron in the sidebar for good.
		*
		* One owner at a time is what makes the layer safe against that: the newest
		* mount claims the document, drops every copy the earlier mounts left behind,
		* and an earlier layer refuses every later write instead of re-anchoring
		* against the new one — the -1/+1 mutation war that once froze the renderer.
		*/
		let owner;
		/**
		* The workspace section's collapse plus the list's fold: state, the injected
		* chevron and fold row, and the observer that keeps both applied while React
		* owns the list.
		*/
		var WorkspaceListFold = class {
			options;
			collapsed = false;
			expanded = false;
			/** Set by {@link dispose}: a disposed layer never writes again, not even from a queued apply. */
			disposed = false;
			/** Group keys the operator unfolded past {@link SESSION_FOLD_LIMIT} sessions. */
			expandedGroups = /* @__PURE__ */ new Set();
			/** One overflow row per folded group, keyed by {@link groupKey}. */
			sessionButtons = /* @__PURE__ */ new Map();
			observer;
			scheduled = false;
			column;
			header;
			chevron;
			button;
			/** Stable header-click handler, so {@link dispose} can always remove it. */
			onHeaderClick = () => {
				this.options.onToggleSection();
			};
			/**
			* The shell's own overflow row (`overflow:<group key>`) expands that group
			* past the shell's idle-session quota; this layer must not pull those rows
			* back out of sight behind the operator. One document-level listener covers
			* every group, present and future.
			*/
			onDocumentClick = (event) => {
				const target = event.target instanceof Element ? event.target.closest(`[data-row-key^="${OVERFLOW_ROW_KEY}"]`) : null;
				if (!(target instanceof HTMLElement)) return;
				this.expandedGroups.add((target.getAttribute("data-row-key") ?? "").slice(9));
				this.apply();
			};
			/**
			* @param options - fold limit, copy, the group ranking, and the two toggle callbacks.
			*/
			constructor(options) {
				this.options = options;
				this.chevron = createChevron();
				this.button = document.createElement("button");
				this.button.type = "button";
				this.button.setAttribute(FOLD_ROW_ATTRIBUTE, "");
				this.button.addEventListener("click", () => {
					this.options.onToggle();
				});
			}
			/**
			* Apply both behaviors and keep them applied until disposal. A mount that
			* finds an earlier layer still owning the document takes the document over:
			* the earlier layer is disposed (its controls leave with it) and refuses
			* every later write, so exactly one layer ever writes.
			* @returns the disposer that stops observing and restores the list and header.
			*/
			start() {
				if (owner !== void 0 && owner !== this) owner.dispose();
				owner = this;
				this.disposed = false;
				this.apply();
				this.observer = new MutationObserver((records) => {
					if (records.some((record) => this.touchesSidebar(record))) this.schedule();
				});
				this.observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				document.addEventListener("click", this.onDocumentClick);
				return () => {
					this.dispose();
				};
			}
			/**
			* Collapse or expand the whole workspace section.
			* @param collapsed - true hides the list, leaving the header as the row that brings it back.
			*/
			setCollapsed(collapsed) {
				if (this.collapsed === collapsed) return;
				this.collapsed = collapsed;
				this.apply();
			}
			/**
			* Fold or unfold the list.
			* @param expanded - true shows every group, false keeps the fold limit.
			*/
			setExpanded(expanded) {
				if (this.expanded === expanded) return;
				this.expanded = expanded;
				if (!expanded) this.expandedGroups.clear();
				this.apply();
			}
			/**
			* Re-rank the groups: the session catalog moved on, so which groups the fold
			* keeps while folded may have changed. The owner calls this after installing
			* a new {@link WorkspaceFoldOptions.recency} lookup.
			*/
			refresh() {
				this.apply();
			}
			/**
			* Stop observing, drop the injected controls, and reveal every group again.
			* Disposal is final and idempotent: a React cleanup, a takeover by a newer
			* mount, and a plugin unload can all reach it, and after the first call the
			* layer must never write again (a queued apply included).
			*/
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				if (owner === this) owner = void 0;
				this.observer?.disconnect();
				this.observer = void 0;
				this.column = void 0;
				document.removeEventListener("click", this.onDocumentClick);
				const container = workspaceListContainer(document);
				if (container !== void 0) for (const group of groupSections(container)) {
					setHidden(group, false);
					for (const row of sessionRows(group)) setHidden(rowSlot(group, row), false);
				}
				for (const button of this.sessionButtons.values()) button.remove();
				this.sessionButtons.clear();
				this.expandedGroups.clear();
				this.button.remove();
				this.chevron.remove();
				if (owner === void 0) for (const node of document.querySelectorAll(`[${FOLD_ROW_ATTRIBUTE}], [${SECTION_CHEVRON_ATTRIBUTE}], [${SESSION_OVERFLOW_ATTRIBUTE}]`)) node.remove();
				if (this.header?.isConnected === true) {
					this.header.removeEventListener("click", this.onHeaderClick);
					this.header.removeAttribute(SECTION_COLLAPSED_ATTRIBUTE);
					this.header.removeAttribute("aria-expanded");
					this.header.style.cursor = "";
					this.header.style.userSelect = "";
				}
				this.header = void 0;
			}
			/** The sidebar column, re-resolved after a replacement or a fresh mount. */
			sidebar() {
				if (this.column?.isConnected !== true) this.column = sidebarColumn();
				return this.column;
			}
			/** Whether one mutation record can affect the list this fold owns. */
			touchesSidebar(record) {
				const column = this.sidebar();
				if (column === void 0) return false;
				if (column.contains(record.target)) return true;
				for (const node of [...record.addedNodes, ...record.removedNodes]) if (node instanceof Element && (node === column || node.contains(column))) return true;
				return false;
			}
			/** Coalesce observer bursts into one application per microtask. */
			schedule() {
				if (this.scheduled) return;
				this.scheduled = true;
				queueMicrotask(() => {
					this.scheduled = false;
					this.apply();
				});
			}
			/**
			* Reconcile the DOM with the current states; every write is compared first.
			* A disposed layer and a layer that another mount has taken the document
			* from both stay silent: a queued apply from before the disposal must not
			* resurrect the controls it just removed, and two writers would re-anchor
			* against each other forever.
			*/
			apply() {
				if (this.disposed) return;
				if (owner === void 0) owner = this;
				if (owner !== this) return;
				this.dropForeignControls();
				const container = workspaceListContainer(document);
				const groups = container === void 0 ? [] : groupSections(container);
				this.applySectionHeader();
				if (container === void 0) {
					this.button.remove();
					return;
				}
				const { visible, hidden } = splitByRecency(groups, this.options.limit, this.expanded, (group) => this.groupRecency(group));
				const kept = new Set(visible);
				const seenGroups = /* @__PURE__ */ new Set();
				for (const group of groups) {
					setHidden(group, this.collapsed || !kept.has(group));
					const key = this.applySessionFold(group);
					if (key !== void 0) seenGroups.add(key);
				}
				for (const [key, button] of this.sessionButtons) if (!seenGroups.has(key)) {
					button.remove();
					this.sessionButtons.delete(key);
					this.expandedGroups.delete(key);
				}
				if (this.collapsed) {
					this.button.remove();
					return;
				}
				const anchor = visible.at(-1);
				if (anchor === void 0 || groups.length <= this.options.limit) {
					this.button.remove();
					return;
				}
				const label = this.expanded ? this.options.labels.collapse : this.options.labels.expand(hidden.length);
				if (this.button.textContent !== label) this.button.textContent = label;
				const expandedState = String(this.expanded);
				if (this.button.getAttribute("aria-expanded") !== expandedState) this.button.setAttribute("aria-expanded", expandedState);
				if (this.button.parentElement !== container || this.button.previousElementSibling !== anchor) anchor.after(this.button);
			}
			/**
			* Remove every injected control the shell is holding that this layer did not
			* create — the leftovers of an earlier mount. The shell never removes a node
			* it did not render, so nothing else in the page will: without this sweep the
			* sidebar shows the old chevron and the old fold row beside the live ones.
			* The sweep runs before every reconciliation, so one pass is enough however
			* many copies an earlier mount left behind.
			*/
			dropForeignControls() {
				for (const node of document.querySelectorAll(`[${FOLD_ROW_ATTRIBUTE}]`)) if (node !== this.button) node.remove();
				for (const node of document.querySelectorAll(`[${SECTION_CHEVRON_ATTRIBUTE}]`)) if (node !== this.chevron) node.remove();
				const mine = new Set(this.sessionButtons.values());
				for (const node of document.querySelectorAll(`[${SESSION_OVERFLOW_ATTRIBUTE}]`)) if (!mine.has(node)) node.remove();
			}
			/**
			* Newest history time the owner reports for one group, or undefined when the
			* section carries no addressable key or the owner knows no history for it —
			* both rank the group last, which is what a folder that holds nothing recent
			* deserves.
			* @param group - one group section.
			* @returns the group's newest history time.
			*/
			groupRecency(group) {
				const key = groupKey(group);
				return key === void 0 ? void 0 : this.options.recency(key);
			}
			/**
			* Enforce the strict per-group session fold: whichever rows the shell chose
			* to render, the group shows only the {@link SESSION_FOLD_LIMIT} newest by
			* history time — running and blank rows included, unlike the shell's own
			* quota — and the rest wait behind one overflow row. The write pattern is the
			* list fold's: rows are hidden with a compared-first inline style and the
			* overflow row is placed only when its position is wrong, so the observer
			* never feeds itself.
			* @param group - one group section.
			* @returns the group's key, or undefined when it carries no addressable header
			* (its rows are then left exactly as the shell rendered them).
			*/
			applySessionFold(group) {
				const key = groupKey(group);
				const rows = sessionRows(group);
				const slots = new Map(rows.map((row) => [row, rowSlot(group, row)]));
				if (key === void 0 || rows.length <= 5 || this.expandedGroups.has(key)) {
					for (const row of rows) setHidden(slots.get(row) ?? row, false);
					this.dropSessionButton(key);
					return key;
				}
				const ranked = rows.map((row, index) => {
					const at = this.options.sessionRecency(sessionRowId(row));
					return {
						row,
						index,
						at: at !== void 0 && Number.isFinite(at) ? at : 0
					};
				}).sort((a, b) => b.at !== a.at ? b.at - a.at : a.index - b.index);
				const kept = new Set(ranked.slice(0, 5).map((entry) => entry.row));
				for (const row of rows) setHidden(slots.get(row) ?? row, !kept.has(row));
				const anchorRow = ranked.filter((entry) => kept.has(entry.row)).at(-1)?.row;
				const anchor = anchorRow === void 0 ? void 0 : slots.get(anchorRow);
				if (anchor === void 0) return key;
				if (shellOverflowRow(group) !== void 0) {
					this.dropSessionButton(key);
					return key;
				}
				this.syncSessionButton(key, anchor, rows.length - 5);
				return key;
			}
			/** Place one group's overflow row behind `anchor` (the last kept row's slot). */
			syncSessionButton(key, anchor, hiddenCount) {
				let button = this.sessionButtons.get(key);
				if (button === void 0) {
					button = document.createElement("button");
					button.type = "button";
					button.setAttribute(SESSION_OVERFLOW_ATTRIBUTE, "");
					button.setAttribute("aria-expanded", "false");
					button.addEventListener("click", () => {
						this.expandedGroups.add(key);
						this.apply();
					});
					this.sessionButtons.set(key, button);
				}
				const label = this.options.labels.sessionExpand(hiddenCount);
				if (button.textContent !== label) button.textContent = label;
				if (button.parentElement !== anchor.parentElement || button.previousElementSibling !== anchor) anchor.after(button);
			}
			/** Remove one group's overflow row, if it has one. */
			dropSessionButton(key) {
				if (key === void 0) return;
				const button = this.sessionButtons.get(key);
				if (button === void 0) return;
				button.remove();
				this.sessionButtons.delete(key);
			}
			/**
			* Adopt the shell's section header: mark it as the collapse toggle, place the
			* chevron, and route clicks on it to the owner. The header's own buttons (view
			* options, search) and the project rows' drag targets keep their own handlers:
			* this listener only sees a click that reached the header itself.
			*/
			applySectionHeader() {
				const header = document.querySelector(`[class*="${SECTION_HEADER_FRAGMENT}"]`);
				if (header === null) {
					this.header = void 0;
					return;
				}
				if (this.header !== header) {
					this.header = header;
					header.setAttribute("role", "button");
					header.style.cursor = "pointer";
					header.style.userSelect = "none";
					header.addEventListener("click", this.onHeaderClick);
				}
				const collapsedState = String(this.collapsed);
				if (header.getAttribute("data-dsh-recent-section") !== collapsedState) {
					header.setAttribute(SECTION_COLLAPSED_ATTRIBUTE, collapsedState);
					header.setAttribute("aria-expanded", String(!this.collapsed));
				}
				const rotation = this.collapsed ? "" : "rotate(90deg)";
				if (this.chevron.style.transform !== rotation) this.chevron.style.transform = rotation;
				const label = header.querySelector(`[class*="${SECTION_LABEL_FRAGMENT}"]`);
				if (!(label instanceof HTMLElement)) {
					if (this.chevron.style.display !== "none") this.chevron.style.display = "none";
					return;
				}
				if (this.chevron.style.display !== "") this.chevron.style.display = "";
				if (this.chevron.previousElementSibling !== label) label.after(this.chevron);
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** `recent` namespace dictionaries (the sidebar 最近 section copy and the workspace fold row). */
		/** Dictionary namespace owned by this plugin. */
		const NS = "recent";
		/**
		* Simplified Chinese dictionary (the key-set source of truth). Every value is
		* the shell's own word for the same element — the rows and the hover card read
		* as the workspace tree's rows do, not as a translation of them.
		*/
		const zh = {
			"section.recent": "最近",
			"view.options": "视图选项",
			"view.showWorkspace": "显示项目名称",
			"fold.expandWorkspaces": "展开其余 {n} 个工作区",
			"fold.expandSessions": "展开其余 {n} 个对话",
			"fold.collapse": "收起",
			"row.open": "打开会话“{name}”",
			"row.pinned": "已置顶",
			"actions.session.aria": "会话“{name}”的操作",
			"actions.archive": "归档会话",
			"actions.unarchive": "取消归档",
			"actions.pin": "置顶会话",
			"actions.unpin": "取消置顶",
			"menu.pinSession": "置顶会话",
			"menu.unpinSession": "取消置顶",
			"menu.fork": "分叉会话",
			"menu.archiveSession": "归档会话",
			"workspace.ungrouped": "未分组",
			"status.running": "进行中",
			"status.waitingApproval": "等待审批",
			"status.planReview": "计划待审",
			"status.waitingAnswer": "等待回答",
			"status.compact.approval": "待审批",
			"status.compact.planReview": "计划待审",
			"status.compact.answer": "待回答",
			"archive.confirm.title": "停止并归档此会话？",
			"archive.confirm.desc": "“{title}”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。",
			"archive.confirm.action": "停止并归档",
			"archive.confirm.pending": "正在停止并归档…",
			"time.now": "刚刚",
			"time.minutes": "{n}分钟",
			"time.hours": "{n}小时",
			"time.days": "{n}天",
			"time.months": "{n}个月",
			"time.years": "{n}年",
			"time.ago": "{t}前"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"section.recent": "Recent",
			"view.options": "View options",
			"view.showWorkspace": "Show project names",
			"fold.expandWorkspaces": "Show {n} more workspaces",
			"fold.expandSessions": "Show {n} more conversations",
			"fold.collapse": "Show less",
			"row.open": "Open session “{name}”",
			"row.pinned": "Pinned",
			"actions.session.aria": "Session actions for {name}",
			"actions.archive": "Archive",
			"actions.unarchive": "Unarchive",
			"actions.pin": "Pin",
			"actions.unpin": "Unpin",
			"menu.pinSession": "Pin session",
			"menu.unpinSession": "Unpin session",
			"menu.fork": "Fork session",
			"menu.archiveSession": "Archive session",
			"workspace.ungrouped": "Ungrouped",
			"status.running": "Running",
			"status.waitingApproval": "Waiting for approval",
			"status.planReview": "Plan awaiting review",
			"status.waitingAnswer": "Waiting for answer",
			"status.compact.approval": "Approval",
			"status.compact.planReview": "Plan review",
			"status.compact.answer": "Answer",
			"archive.confirm.title": "Stop and archive this session?",
			"archive.confirm.desc": "“{title}” still has work in progress. Archiving stops it first; you can restore the session later from the “All conversations (show archived)” filter in the sidebar, and the stopped work will not resume on its own.",
			"archive.confirm.action": "Stop and archive",
			"archive.confirm.pending": "Stopping and archiving…",
			"time.now": "now",
			"time.minutes": "{n}min",
			"time.hours": "{n}h",
			"time.days": "{n}d",
			"time.months": "{n}mo",
			"time.years": "{n}y",
			"time.ago": "{t} ago"
		};
		//#endregion
		//#region src/client/viewOptions.ts
		/**
		* Persistence for the section's view options.
		*
		* A view option is a setting, not a look: the choice to name each row's project
		* survives reloads and browser restarts, and so does the workspace list's
		* unfolded choice (held alongside this key in ./workspaceFold.ts). The sidebar
		* column is browser-local chrome, so the browser's own
		* store is the right registry; the shell's account-level settings would carry
		* the choice across machines that never shared the list's look anyway.
		*/
		/** The local-store key holding the project-line choice. */
		const STORE_KEY = "dsh-recent:view.showWorkspace";
		/**
		* Interpret one stored raw value. Only the exact string `'1'` counts as on:
		* anything else — absent, empty, corrupted — means the default, so a bad
		* stored value degrades to the quiet single-line list rather than getting
		* stuck showing a line the operator turned off.
		* @param raw - the raw stored value (null when the key is absent).
		* @returns whether the project line shows.
		*/
		function parseStoredFlag(raw) {
			return raw === "1";
		}
		/**
		* Read the stored project-line choice.
		* @param store - the storage to read (the browser's local store, or a test double).
		* @returns whether the project line shows.
		*/
		function loadShowWorkspace(store = window.localStorage) {
			try {
				return parseStoredFlag(store.getItem(STORE_KEY));
			} catch {
				return false;
			}
		}
		/**
		* Store the project-line choice. A failed write (private mode, quota) is not
		* an error the section can act on — the choice still holds for this visit.
		* @param value - whether the project line should show.
		* @param store - the storage to write (the browser's local store, or a test double).
		*/
		function saveShowWorkspace(value, store = window.localStorage) {
			try {
				store.setItem(STORE_KEY, value ? "1" : "0");
			} catch {}
		}
		//#endregion
		//#region \0dsh-css:src/client/RecentSessions.module.css.mjs
		const css = ".aalpzW_section{flex-direction:column;min-width:0;padding:12px 0 2px;display:flex}.aalpzW_header{width:100%;height:36px;color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:4px;margin-bottom:4px;padding-left:4px;display:flex}.aalpzW_headerToggle{min-width:0;height:100%;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:12px;flex:1;align-items:center;gap:4px;padding:0;font-family:inherit;font-size:14px;font-weight:400;line-height:20px;display:flex}.aalpzW_headerButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aalpzW_headerButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aalpzW_viewMenu{min-width:200px}.aalpzW_chevron{transition:transform .15s var(--ds-ease-in-out);flex:none}.aalpzW_chevronOpen{transform:rotate(90deg)}[data-dsh-recent-section-chevron]{transition:transform .15s var(--ds-ease-in-out);flex:none}.aalpzW_list{margin:0;padding:0;list-style:none}.aalpzW_groupGap{margin-top:10px}.aalpzW_sentinel{height:1px;margin:0;padding:0}.aalpzW_row{box-sizing:border-box;isolation:isolate;width:100%;height:32px;padding:0 8px;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;background:0 0;border:none;align-items:center;gap:0;padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));font-size:14px;line-height:20px;display:flex;position:relative}.aalpzW_row:before{content:\"\";z-index:-1;border-radius:var(--dsw-radius-md);pointer-events:none;background:0 0;position:absolute;inset:0 4px}.aalpzW_row:hover:before,.aalpzW_rowActive:before,.aalpzW_rowCurrent:before{background:var(--dsw-alias-interactive-bg-hover)}.aalpzW_row[data-workspace]{flex-wrap:wrap;align-content:center;height:auto;min-height:44px;padding-top:4px;padding-bottom:4px}.aalpzW_workspace{box-sizing:border-box;white-space:nowrap;text-overflow:ellipsis;min-width:0;color:var(--dsw-alias-label-tertiary);flex:0 0 100%;padding-left:20px;font-size:12px;line-height:17px;overflow:hidden}.aalpzW_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.aalpzW_title{white-space:nowrap;text-overflow:ellipsis;flex:1;min-width:0;margin:0 6px 0 4px;overflow:hidden}.aalpzW_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;line-height:16px}.aalpzW_pinIndicator{width:16px;height:20px;color:var(--dsw-alias-label-caption);flex:none;justify-content:center;align-items:center;margin-left:6px;display:inline-flex}.aalpzW_rowTrailing{flex:none;justify-content:flex-end;align-items:center;gap:6px;width:74px;height:20px;display:flex}.aalpzW_rowActions{flex:none;align-items:center;gap:10px;display:inline-flex}.aalpzW_iconButton{border-radius:var(--dsw-radius-xs);width:16px;height:16px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aalpzW_iconButton:hover{color:var(--dsw-alias-label-primary)}.aalpzW_card{flex-direction:column;gap:8px;min-width:0;display:flex}body>div:has(>[data-recent-stale]){visibility:hidden;pointer-events:none}.aalpzW_cardTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}.aalpzW_cardTime{color:#cfd3d6;font-size:12px;line-height:16px}.aalpzW_cardStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}.aalpzW_cardWorkspace{color:#cfd3d6;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:16px;display:flex}.aalpzW_cardFolder{flex:none}.aalpzW_cardWorkspaceName{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}.aalpzW_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}.aalpzW_archiveError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}[data-dsh-recent-fold]{color:#adb2b85e;cursor:pointer;text-align:left;background:0 0;border:none;border-radius:8px;flex:none;width:100%;height:28px;padding:6px 12px 0 6px;font-size:14px}[data-dsh-recent-fold]:hover{color:var(--dsw-alias-label-secondary);background:0 0}[data-dsh-recent-session-overflow]{border-radius:var(--dsw-radius-sm);width:100%;height:28px;padding:0 12px 0 calc(28px + var(--dsh-workspace-indent,0px));cursor:pointer;text-align:left;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;font-size:12px}[data-dsh-recent-session-overflow]:hover{color:var(--dsw-alias-label-secondary);background:0 0}[class*=_groupSection]>[data-dsh-recent-session-overflow]{margin-top:0}.aalpzW_visuallyHidden{clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}@media (prefers-reduced-motion:reduce){.aalpzW_chevron,[data-dsh-recent-section-chevron]{transition:none}}";
		const tagId = "dsh-recent/RecentSessions.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-recent";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var RecentSessions_module_css_default = {
			"archiveError": "aalpzW_archiveError",
			"card": "aalpzW_card",
			"cardFolder": "aalpzW_cardFolder",
			"cardStatus": "aalpzW_cardStatus",
			"cardTime": "aalpzW_cardTime",
			"cardTitle": "aalpzW_cardTitle",
			"cardWorkspace": "aalpzW_cardWorkspace",
			"cardWorkspaceName": "aalpzW_cardWorkspaceName",
			"chevron": "aalpzW_chevron",
			"chevronOpen": "aalpzW_chevronOpen",
			"deleteAction": "aalpzW_deleteAction",
			"groupGap": "aalpzW_groupGap",
			"header": "aalpzW_header",
			"headerButton": "aalpzW_headerButton",
			"headerToggle": "aalpzW_headerToggle",
			"iconButton": "aalpzW_iconButton",
			"list": "aalpzW_list",
			"pinIndicator": "aalpzW_pinIndicator",
			"row": "aalpzW_row",
			"rowActions": "aalpzW_rowActions",
			"rowActive": "aalpzW_rowActive",
			"rowCurrent": "aalpzW_rowCurrent",
			"rowTrailing": "aalpzW_rowTrailing",
			"section": "aalpzW_section",
			"sentinel": "aalpzW_sentinel",
			"slot": "aalpzW_slot",
			"time": "aalpzW_time",
			"title": "aalpzW_title",
			"viewMenu": "aalpzW_viewMenu",
			"visuallyHidden": "aalpzW_visuallyHidden",
			"workspace": "aalpzW_workspace"
		};
		//#endregion
		//#region src/client/RecentSessions.tsx
		/**
		* The sidebar 最近 section: every workspace's newest sessions flattened into
		* one jump list, registered into the sidebar's `sidebar.footer.action` seat and
		* then portalled into the workspace list's own scroll area — so it reads as the
		* last content of the 工作区 column ("find the project folder above, open the
		* latest work below") rather than as a block of the sidebar foot, and the
		* column scrolls as one surface from the project tree into older sessions.
		*
		* The same component owns the fold control for the shell's workspace section
		* ({@link WorkspaceListFold}): its header chevron collapses the whole list, and
		* the trailing row keeps the five folders with the newest history, folding every
		* other one — the ungrouped bucket included — behind itself. This section does not
		* fold: it renders a window over every session that holds history and appends
		* one more page of older sessions whenever the end of that window scrolls into
		* view, so the list keeps growing instead of holding the rest behind a row.
		*
		* The seat hands the component the column's `wide` flag only; session and
		* workspace facts arrive through the framework standard kit
		* (`useSessions`/`useSessionStatus`/`useWorkspaces`), and the actions a row
		* performs arrive through the registration's injected face
		* ({@link RecentActions}). A 56px rail has no room for a list, so the section
		* renders only while the column is wide — and re-showing the column returns
		* this list to its first page, while the workspace list's unfolded choice is
		* kept (it is a setting, held in the browser's local store).
		*
		* A row is the shell's own session row, element for element: the 16px leading
		* cell holding the live-state dot, the title, the trailing age (or the compact
		* label of the interaction that waits), the resting pin marker, and — on hover,
		* where the age and the marker give way to it — the row's actions. The hover
		* card is the shell's session card: full title, age, and the live-state line.
		* The two lists read as one column because they are the same rows: same
		* metrics, same colors, same elements, in every state.
		*/
		/** Refresh cadence of the trailing relative-time labels. */
		const CLOCK_TICK_MS = 3e4;
		/**
		* How far past the visible column the end of the rendered window still counts
		* as reached. The next page arrives before the operator actually hits the
		* bottom, so scrolling into history never runs into a hole.
		*/
		const LOAD_AHEAD_PX = 320;
		/**
		* List area the section is portalled into: the shell's own scroller for the
		* workspace tree, which is also where the section belongs — the column scrolls
		* as one surface and this block is its last content. Mirrors the fold layer's
		* own resolution so both agree about where the list ends.
		*
		* The shell swaps that area whenever the browser switches between the
		* workspace tree, the flat list, and search results, which leaves a section
		* portalled into the replaced element detached and invisible. So the observer
		* runs for as long as the section is mounted and re-resolves the area whenever
		* the current one leaves the document — a re-render then moves the portal into
		* the new area. A flat or search rendering resolves no area at all (no group
		* sections), and the section keeps its last one and stays hidden until the
		* workspace tree comes back.
		*
		* The same observer keeps the section the area's last child: the shell appends
		* new group sections (a workspace added while the column is open, the trailing
		* bucket for sessions no workspace claims) with a plain append, which lands them
		* *after* this block. A portal's position among React's children is not React's
		* to own, so putting it back is this side's job.
		* @param section - the section element, so the observer can re-place it.
		* @returns the area to portal into, or undefined before the browser mounts.
		*/
		function useWorkspaceListArea(section) {
			const [area, setArea] = (0, react.useState)(() => workspaceListContainer(document));
			const current = (0, react.useRef)(area);
			current.current = area;
			(0, react.useEffect)(() => {
				const sync = () => {
					const held = current.current;
					if (held?.isConnected !== true) {
						const next = workspaceListContainer(document);
						if (next !== void 0) setArea(next);
						return;
					}
					const mounted = section.current;
					if (mounted !== null && mounted.parentElement === held && held.lastElementChild !== mounted) held.append(mounted);
				};
				sync();
				const observer = new MutationObserver(sync);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
				};
			}, [section]);
			return area;
		}
		/**
		* Hover dwell before the row's card shows: none. The primitive's 500ms default
		* (and the 150ms beat this section first traded down to) still reads as lag on
		* a jump list this dense — the pointer is already on the row the card body
		* describes, so there is nothing to wait for. The card is the shell's session
		* card drawn the shell's way; only this beat is shorter, and the workspace
		* tree's own 800ms dwell is the shell's choice for its rows rather than a
		* property of the card.
		*
		* Sweeps across the list stay quiet without a dwell, because a card the pointer
		* has left is hidden the moment another row takes the hover (see
		* {@link RecentRowCard}'s stale marker): crossing the list shows one card that
		* follows the pointer, never a stack of panels left behind on the way.
		*/
		const CARD_DWELL_MS = 0;
		/** Current epoch ms, re-read on a slow tick so ages stay honest without a busy timer. */
		function useNow() {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, CLOCK_TICK_MS);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			return now;
		}
		/** Localized compact age ("刚刚"/"5分钟" in zh, "now"/"5min" in en) — the row's trailing label. */
		function timeLabel(t, updatedAt, now) {
			const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
			return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
		}
		/**
		* The card's age line: distances wrap in the ago template and the now bucket
		* stays bare (no "now ago"), which is the shell's own hover-card wording.
		*/
		function hoverTimeLabel(t, updatedAt, now) {
			const { unit, n } = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(updatedAt, now);
			return unit === "now" ? t("time.now") : t("time.ago", { t: t(`time.${unit}`, { n }) });
		}
		/**
		* The two labels one waiting interaction carries: the state line the row and
		* its card show, and the compact label that replaces the age while it waits —
		* the shell's own pair of words for each of the three kinds its rows mark.
		*/
		const PENDING = {
			"approval": {
				label: "status.waitingApproval",
				compact: "status.compact.approval"
			},
			"plan-review": {
				label: "status.planReview",
				compact: "status.compact.planReview"
			},
			"question": {
				label: "status.waitingAnswer",
				compact: "status.compact.answer"
			}
		};
		/**
		* Live state of one row. The unified status snapshot is the same source the
		* workspace tree's rows read, so the two surfaces show the same dot.
		* @param row - the derived row.
		* @returns the dot state, or undefined when the session is idle.
		*/
		function rowState(row) {
			if (row.pending !== void 0) return "warning";
			return row.running ? "ongoing" : void 0;
		}
		/**
		* The live-state line one row and its card carry: the interaction that waits on
		* this user, or the running state. The shell's rows say the same thing in the
		* same order.
		* @param row - the derived row.
		* @param t - locale seat.
		* @returns the label, or undefined when the session is idle.
		*/
		function statusLabel(row, t) {
			if (row.pending !== void 0) return t(PENDING[row.pending].label);
			return row.running ? t("status.running") : void 0;
		}
		/**
		* The row's hover-card body: the shell's own session-card pattern (full title,
		* age, one live-state line when the session runs or waits) plus the one fact a
		* flat cross-project list has to carry — the workspace the session belongs to,
		* on the line the shell's card reserves for extra sections (its
		* `sidebar.session.row.hover` seat), so the live state stays the trailing line.
		*
		* `stale` marks the body of a card the pointer has already left for another
		* row. The primitive keeps that card mounted for its own pointer grace, so the
		* stylesheet hides the whole card on this marker: a sweep down the list swaps
		* one visible panel per row instead of stacking every panel it crossed.
		* @param props.row - the derived row this card describes.
		* @param props.t - locale seat.
		* @param props.now - current epoch ms for the age label.
		* @param props.stale - whether another row currently owns the hover.
		* @returns the card body.
		*/
		function RecentRowCard({ row, t, now, stale }) {
			const state = rowState(row);
			const label = statusLabel(row, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: RecentSessions_module_css_default.card,
				"data-recent-stale": stale ? "" : void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: RecentSessions_module_css_default.cardTitle,
						children: row.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: RecentSessions_module_css_default.cardTime,
						children: hoverTimeLabel(t, row.updatedAt, now)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: RecentSessions_module_css_default.cardWorkspace,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, {
							className: RecentSessions_module_css_default.cardFolder,
							size: 14
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: RecentSessions_module_css_default.cardWorkspaceName,
							children: row.workspace
						})]
					}),
					state !== void 0 && label !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: RecentSessions_module_css_default.cardStatus,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
					})
				]
			});
		}
		/**
		* The section's view-options menu: the workspace section header's own sliders
		* button and menu, borrowed element for element — the 28px icon button, the
		* dense portalled card aligned to its end, a heading row naming the menu, and
		* one checkable row per option with the check marking what is on. Selecting
		* the checked row clears it: these are independent switches, not a radio
		* group, so every row toggles its own fact.
		* @param props.showWorkspace - whether rows carry the project-name line.
		* @param props.onToggleWorkspace - flip the project-name line.
		* @param props.t - locale seat.
		* @returns the menu.
		*/
		function ViewOptionsMenu({ showWorkspace, onToggleWorkspace, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				onClose: () => {
					setOpen(false);
				},
				items: [{
					type: "label",
					id: "view.label",
					text: t("view.options")
				}, {
					id: "show-workspace",
					label: t("view.showWorkspace"),
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderCloseRegular, { size: 14 })
				}],
				selectedIds: showWorkspace ? ["show-workspace"] : [],
				onSelect: (id) => {
					setOpen(false);
					if (id === "show-workspace") onToggleWorkspace();
				},
				align: "end",
				dense: true,
				portal: true,
				listClassName: RecentSessions_module_css_default.viewMenu,
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("view.options"),
					side: "bottom",
					align: "end",
					delayMs: 500,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: RecentSessions_module_css_default.headerButton,
						"aria-label": t("view.options"),
						onClick: () => {
							setOpen((current) => !current);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSlidersTwoOutlineRegular, {})
					})
				})
			});
		}
		/**
		* One session row: the shell's own session row — leading state cell, title, the
		* age (or the waiting interaction's compact label), the resting pin marker —
		* with the age's place taken by the row's actions while the row is hovered or
		* its menu is open, exactly as the shell's rows do. The actions really do take
		* the age's place in the markup, rather than sitting under it in the document
		* behind a `display` rule: the controls the row offers and the box it paints
		* them in are the pointer's, so a sweep down the list mounts one row's actions
		* and unmounts the last one's instead of leaving them all in the column. The
		* workspace/age card rides on hover, and the card clicks through to copying the
		* title, the same affordance the workspace tree's session card gives.
		*
		* The row reports its own hover up to the section ({@link onHover}), which is
		* what lets a card the pointer has left be hidden while the primitive still
		* holds it: the section knows which row owns the hover, the card body only
		* needs to know whether it is that row. Only taking the hover is reported —
		* leaving is not news, because a card the pointer abandoned has to stay hidden
		* until it unmounts, not become the one visible card again.
		*
		* The card is suppressed while the row's menu is open, so it never covers the
		* list the menu opened over — the shell's rows disable theirs the same way.
		* @param props.row - the derived row.
		* @param props.now - current epoch ms for the age label.
		* @param props.t - locale seat.
		* @param props.actions - the session actions this row performs.
		* @param props.onArchive - archive this row, raising the confirmation when the Host refuses.
		* @param props.stale - whether another row currently owns the hover.
		* @param props.onHover - announce that this row took the hover.
		* @param props.showWorkspace - whether the row carries the project-name line.
		* @param props.separatesGroups - whether this row opens the idle group right
		*   after the running one, so its `li` carries the gap between the two states.
		* @returns the row element.
		*/
		function RecentRowItem({ row, now, t, actions, onArchive, stale, onHover, showWorkspace, separatesGroups }) {
			const state = rowState(row);
			const label = statusLabel(row, t);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [hovered, setHovered] = (0, react.useState)(false);
			const active = hovered || menuOpen;
			const rowClass = [
				RecentSessions_module_css_default.row,
				active ? RecentSessions_module_css_default.rowActive : "",
				row.current ? RecentSessions_module_css_default.rowCurrent : ""
			].filter((part) => part !== "").join(" ");
			const pinLabel = row.pinned ? t("actions.unpin") : t("actions.pin");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				onPointerEnter: onHover,
				className: separatesGroups ? RecentSessions_module_css_default.groupGap : void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
					anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: rowClass,
						role: "treeitem",
						tabIndex: 0,
						"data-workspace": showWorkspace ? "" : void 0,
						"data-row-key": `session:${row.id}`,
						"aria-label": t("row.open", { name: row.title }),
						"aria-selected": row.current,
						onClick: () => {
							actions.open(row.id);
						},
						onPointerEnter: () => {
							setHovered(true);
						},
						onPointerLeave: () => {
							setHovered(false);
						},
						draggable: true,
						onDragStart: (event) => {
							event.dataTransfer.effectAllowed = "move";
							event.dataTransfer.setData("text/plain", row.id);
						},
						onKeyDown: (event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							actions.open(row.id);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: RecentSessions_module_css_default.slot,
								children: [state !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state }), label !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: RecentSessions_module_css_default.visuallyHidden,
									children: label
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: RecentSessions_module_css_default.title,
								children: row.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: RecentSessions_module_css_default.rowTrailing,
								children: [
									!active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: RecentSessions_module_css_default.time,
										"aria-hidden": row.pending === void 0 ? void 0 : true,
										children: row.pending === void 0 ? timeLabel(t, row.updatedAt, now) : t(PENDING[row.pending].compact)
									}),
									!active && row.pinned && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: RecentSessions_module_css_default.pinIndicator,
										role: "img",
										"aria-label": t("row.pinned"),
										title: t("row.pinned"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, { size: 14 })
									}),
									active && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: RecentSessions_module_css_default.rowActions,
										onClick: (event) => {
											event.stopPropagation();
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
												open: menuOpen,
												onClose: () => {
													setMenuOpen(false);
												},
												portal: true,
												closeOnPointerLeave: true,
												anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: RecentSessions_module_css_default.iconButton,
													"aria-label": t("actions.session.aria", { name: row.title }),
													onClick: () => {
														setMenuOpen((open) => !open);
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, {})
												}),
												items: [
													{
														id: "pin",
														label: t(row.pinned ? "menu.unpinSession" : "menu.pinSession"),
														icon: row.pinned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinOutlineRegular, {})
													},
													{
														id: "fork",
														label: t("menu.fork"),
														icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {})
													},
													{
														id: "archive",
														label: t("menu.archiveSession"),
														icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 })
													}
												],
												onSelect: (id) => {
													setMenuOpen(false);
													if (id === "pin") (row.pinned ? actions.unpin : actions.pin)(row.id);
													else if (id === "fork") actions.fork(row.id);
													else onArchive(row);
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
												label: t("actions.archive"),
												side: "bottom",
												align: "end",
												delayMs: 500,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: RecentSessions_module_css_default.iconButton,
													"aria-label": t("actions.archive"),
													onClick: () => {
														onArchive(row);
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 })
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
												label: pinLabel,
												side: "bottom",
												align: "end",
												delayMs: 500,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: RecentSessions_module_css_default.iconButton,
													"aria-label": pinLabel,
													onClick: () => {
														(row.pinned ? actions.unpin : actions.pin)(row.id);
													},
													children: row.pinned ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinFillRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPinOutlineRegular, { size: 14 })
												})
											})
										]
									})
								]
							}),
							showWorkspace && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: RecentSessions_module_css_default.workspace,
								children: row.workspace
							})
						]
					}),
					content: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RecentRowCard, {
						row,
						t,
						now,
						stale
					}),
					copyText: row.title,
					copyLabel: t("copy"),
					copiedLabel: t("copied"),
					openDelayMs: CARD_DWELL_MS,
					disabled: menuOpen
				})
			});
		}
		/**
		* The Host refused to archive a Session that still has work: the shell's own
		* stop-and-archive confirmation, on the shell's own wording and its single
		* action. The shell's dialog also lists what the refusal named; this one keeps
		* the question without enumerating the work.
		* @param props.request - the Session the Host refused, with its row title.
		* @param props.stopAndArchive - stop that Session's work and archive it.
		* @param props.onSettle - close the dialog, once the request is done.
		* @param props.t - locale seat.
		* @returns the dialog.
		*/
		function ArchiveConfirm({ request, stopAndArchive, onSettle, t }) {
			const [pending, setPending] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const close = () => {
				if (!pending) onSettle();
			};
			const confirm = () => {
				setPending(true);
				setError(void 0);
				stopAndArchive(request.id).then(() => {
					setPending(false);
					onSettle();
				}).catch((reason) => {
					setPending(false);
					setError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("close"),
				title: t("archive.confirm.title"),
				description: t("archive.confirm.desc", { title: request.title }),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					disabled: pending,
					onClick: close,
					children: t("cancel")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					className: RecentSessions_module_css_default.deleteAction,
					disabled: pending,
					onClick: confirm,
					children: pending ? t("archive.confirm.pending") : t("archive.confirm.action")
				})] }),
				children: error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: RecentSessions_module_css_default.archiveError,
					children: error
				})
			});
		}
		/**
		* Render the 最近 section and keep the workspace section folded the same way.
		* @param props - composed slot props (owner wide flag, standard kit hooks, injected actions, locale seat).
		* @returns the section element, or null while the rail is collapsed or no session holds history.
		*/
		function RecentSessions({ wide, t, useSessions, useSessionStatus, useWorkspaces, open, archive, stopAndArchive, pin, unpin, fork }) {
			const list = useSessions((snapshot) => snapshot);
			const status = useSessionStatus((snapshot) => snapshot);
			const workspaces = useWorkspaces((snapshot) => snapshot);
			const now = useNow();
			const [recentFolded, setRecentFolded] = (0, react.useState)(false);
			const [rendered, setRendered] = (0, react.useState)(20);
			const [showWorkspace, setShowWorkspace] = (0, react.useState)(() => loadShowWorkspace());
			const [workspaceExpanded, setWorkspaceExpanded] = (0, react.useState)(() => loadWorkspaceExpanded());
			(0, react.useEffect)(() => {
				saveWorkspaceExpanded(workspaceExpanded);
			}, [workspaceExpanded]);
			const [workspaceCollapsed, setWorkspaceCollapsed] = (0, react.useState)(false);
			const [hoveredID, setHoveredID] = (0, react.useState)(void 0);
			const [archiveRequest, setArchiveRequest] = (0, react.useState)(void 0);
			const section = (0, react.useRef)(null);
			const sentinel = (0, react.useRef)(null);
			const area = useWorkspaceListArea(section);
			const actions = (0, react.useMemo)(() => ({
				open,
				archive,
				stopAndArchive,
				pin,
				unpin,
				fork
			}), [
				open,
				archive,
				stopAndArchive,
				pin,
				unpin,
				fork
			]);
			const rows = (0, react.useMemo)(() => deriveRecentRows({
				list,
				status,
				workspaces: workspaces.items,
				archivedSessionIds: workspaces.archivedSessionIds,
				pinnedSessionIds: workspaces.pinnedSessionIds,
				ungroupedLabel: t("workspace.ungrouped")
			}), [
				list,
				status,
				workspaces,
				t
			]);
			const archiveRow = (0, react.useCallback)((row) => {
				actions.archive(row.id).then((outcome) => {
					if (outcome !== "active") return;
					setArchiveRequest({
						id: row.id,
						title: row.title
					});
				});
			}, [actions]);
			const recency = (0, react.useMemo)(() => groupRecency({
				list,
				workspaces: workspaces.items,
				archivedSessionIds: workspaces.archivedSessionIds
			}), [list, workspaces]);
			const recencyRef = (0, react.useRef)(recency);
			recencyRef.current = recency;
			const sessionRecencyRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			sessionRecencyRef.current = (0, react.useMemo)(() => {
				const newest = /* @__PURE__ */ new Map();
				for (const id of list.ids) {
					const session = list.byId[id];
					if (session === void 0) continue;
					if (session.origin === "subagent") continue;
					newest.set(id, session.updatedAt);
				}
				return newest;
			}, [list]);
			const foldOptions = (0, react.useMemo)(() => ({
				limit: 5,
				labels: {
					expand: (hidden) => t("fold.expandWorkspaces", { n: hidden }),
					collapse: t("fold.collapse"),
					sessionExpand: (hidden) => t("fold.expandSessions", { n: hidden })
				},
				recency: (key) => recencyRef.current.get(key),
				sessionRecency: (id) => sessionRecencyRef.current.get(id),
				onToggle: () => {
					setWorkspaceExpanded((current) => !current);
				},
				onToggleSection: () => {
					setWorkspaceCollapsed((current) => !current);
				}
			}), [t]);
			const fold = (0, react.useMemo)(() => new WorkspaceListFold(foldOptions), [foldOptions]);
			(0, react.useEffect)(() => fold.start(), [fold]);
			(0, react.useEffect)(() => {
				fold.setExpanded(workspaceExpanded);
			}, [fold, workspaceExpanded]);
			(0, react.useEffect)(() => {
				fold.setCollapsed(workspaceCollapsed);
			}, [fold, workspaceCollapsed]);
			(0, react.useEffect)(() => {
				if (workspaceCollapsed) setWorkspaceExpanded(false);
			}, [workspaceCollapsed]);
			(0, react.useEffect)(() => {
				fold.refresh();
			}, [fold, recency]);
			(0, react.useEffect)(() => {
				if (!wide) return;
				setRecentFolded(false);
				setRendered(20);
			}, [wide]);
			(0, react.useEffect)(() => {
				const marker = sentinel.current;
				if (marker === null || area === void 0) return;
				const observer = new IntersectionObserver((entries) => {
					if (!entries.some((entry) => entry.isIntersecting)) return;
					setRendered((current) => growWindow(current, rows.length));
				}, {
					root: area,
					rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px`
				});
				observer.observe(marker);
				return () => {
					observer.disconnect();
				};
			}, [
				area,
				rendered,
				rows.length
			]);
			if (!wide || rows.length === 0) return null;
			const visibleRows = rows.slice(0, rendered);
			const body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: section,
				className: RecentSessions_module_css_default.section,
				"data-slot": "sidebar.recent.section",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: RecentSessions_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: RecentSessions_module_css_default.headerToggle,
							"aria-expanded": !recentFolded,
							"aria-label": t("section.recent"),
							onClick: () => {
								setRecentFolded((current) => !current);
							},
							children: [t("section.recent"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: recentFolded ? RecentSessions_module_css_default.chevron : `${RecentSessions_module_css_default.chevron} ${RecentSessions_module_css_default.chevronOpen}` })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {
							showWorkspace,
							onToggleWorkspace: () => {
								setShowWorkspace((current) => {
									saveShowWorkspace(!current);
									return !current;
								});
							},
							t
						})]
					}),
					!recentFolded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: RecentSessions_module_css_default.list,
						children: [visibleRows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RecentRowItem, {
							row,
							now,
							t,
							actions,
							onArchive: archiveRow,
							stale: hoveredID !== void 0 && hoveredID !== row.id,
							onHover: () => {
								setHoveredID((current) => current === row.id ? current : row.id);
							},
							showWorkspace,
							separatesGroups: index > 0 && visibleRows[index - 1]?.running === true && !row.running
						}, row.id)), visibleRows.length < rows.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
							ref: sentinel,
							className: RecentSessions_module_css_default.sentinel,
							"aria-hidden": "true"
						})]
					}),
					archiveRequest !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveConfirm, {
						request: archiveRequest,
						stopAndArchive,
						onSettle: () => {
							setArchiveRequest(void 0);
						},
						t
					})
				]
			});
			if (area === void 0) return null;
			return (0, react_dom.createPortal)(body, area);
		}
		//#endregion
		//#region src/client/sessionActions.ts
		/**
		* Whether a failure is the Host's refusal to archive a Session with live work.
		*
		* The refusal is the workspace controller's `WorkspaceArchiveError` carrying
		* `workspace/session-active`, which names what still runs. It is recognized by
		* shape rather than by class: the plugin's browser half may only require the
		* module-table words (react, react-dom, and the primitives), so it cannot
		* import the controller's error class.
		* @param reason - the rejection reason from an archive call.
		* @returns true for the active-Session refusal.
		*/
		function isActiveRefusal(reason) {
			if (!(reason instanceof Error) || reason.name !== "WorkspaceArchiveError") return false;
			return reason.rpcError?.code === "workspace/session-active";
		}
		/**
		* Bind the row actions to the workspace service. Failures of the fire-and-forget
		* calls (pin, unpin, fork) are logged: they leave the row as it was, and this
		* plugin owns no notice surface to report them on.
		* @param uiWorkspace - the shell's workspace navigation service.
		* @returns the action face the section hands to its rows.
		*/
		function recentActions(uiWorkspace) {
			const warn = (what) => (reason) => {
				console.warn(`dsh-recent: ${what} rejected:`, reason);
			};
			return {
				open: (sessionId) => {
					uiWorkspace.openSession(sessionId);
				},
				archive: async (sessionId) => {
					try {
						await uiWorkspace.archiveSession(sessionId);
						return "archived";
					} catch (reason) {
						if (isActiveRefusal(reason)) return "active";
						warn("session archive")(reason);
						return "failed";
					}
				},
				stopAndArchive: (sessionId) => uiWorkspace.archiveSession(sessionId, { stopActivity: true }),
				pin: (sessionId) => {
					uiWorkspace.pinSession(sessionId).catch(warn("session pin"));
				},
				unpin: (sessionId) => {
					uiWorkspace.unpinSession(sessionId).catch(warn("session unpin"));
				},
				fork: (sessionId) => {
					uiWorkspace.forkSession(sessionId).catch(warn("session fork"));
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* Required services: the slot registry, the locale service, and the two owners
		* of the standard kit this section reads. `uiSession` and `uiWorkspace` are the
		* plugins that publish the `useSessions` / `useSessionStatus` / `useWorkspaces`
		* root hooks, so waiting on them keeps the first render from seeing them absent.
		*/
		const inject = [
			"slots",
			"locale",
			"uiSession",
			"uiWorkspace"
		];
		/**
		* Client plugin body: contribute the 最近 section to the sidebar foot. The
		* registration rides the slot service's inject wrapper, so unloading the
		* plugin removes the section with its fiber.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-recent: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "recent",
				order: 30,
				locale: NS,
				inject: () => recentActions(ctx.uiWorkspace)
			}, RecentSessions));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
