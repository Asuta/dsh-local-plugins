# Message re-edit: safety and feasibility assessment

As of 2026-10-26. Target runtime: `D:\SoftWare\dsh\resources\app.asar\dsh` (`@deepseek-ai/dsh-session-persistence-jsonl` manifest version `0.2.1-rc.3`).

## Outcome

**Do not implement or install a destructive re-edit button against the current public runtime contract.** No safe native truncate/edit/rewind transaction was found. Replacing a surface node, forking, or appending edited text would retain the old history or add another message and violate the requested semantics. A bundle that always refuses Send would not fulfill the feature, so no such bundle has been created.

This is a current-contract conclusion, not a claim that an offline maintenance implementation is mathematically impossible. Byte-level rebuilding is possible in principle; the missing pieces are coordinated ownership, admission, durable multi-store erasure, cache invalidation, wire reset, and rerunning an existing user event. Implementing those by patching private runtime objects would recreate a kernel transaction without a complete safety contract.

## Authorized result and boundaries

The intended result is an inline editor next to Copy on a user message, with Cancel/Send. Send requires explicit irreversible confirmation, replaces the original user message at its existing sequence, permanently removes every later history event, and answers from the edited message without appending a second user message. It must state that deleting chat history does not undo files or external operations. No extra backup, recycle bin, or undo is permitted. Running targets must be refused until the user stops them. Concurrency, persistence, projections, and compaction boundaries must fail closed.

No real user Session was opened, rewritten, unloaded, cancelled, resumed, searched, or submitted to during this investigation. Runtime code and an existing workspace plugin were inspected read-only. No plugin was installed and no DSH implementation or profile configuration was edited. The only authored file is this isolated report.

## Discovery procedure

Loaded `cordis-plugin-development`, its host-plugin, ui-plugin, practices, and user-actions references, and `cordis-composition-reference`. Called `cordis_inspect_list` before querying APIs. Queried exact Host contracts for `sessionController`, `sessionPersistence`, `sessions`, `sessionQuery`, and `sessionProjectionCache`. Queried Config to resolve installed package names and the persistence package directory. Read shipped source and READMEs only through Host file-read tools, which support app.asar.

Client `Slots.listSubTree` timed out after 10 seconds with a request to reconnect the Harness page. No live message action-slot contract or rendered UI was verified. That UI discovery failure is separate from the decisive Host safety blockers.

## Verified native contracts

### Session controller

`sessionController` exposes inspection/list/search/create/model/rename/fork/prompt/attachment/updateQueue/cancel/page/follow/projections/control. There is no exposed truncate/edit/rewind or answer-existing-message operation. `updateQueue` changes still-pending inbox occurrences only; it cannot edit an admitted historical message. `fork` copies a prefix into a new identity and retains the source.

The controller README explains that prompts enter the Agent inbox and become durable user messages; request-id retries only deduplicate the same prompt submission. History follows cursor/sequence-ordered durable events. None of that defines a destructive same-id lower-sequence reset.

### Persistence and the live Session

The inspected `sessionPersistence` contract explicitly says: durable append-only storage; events are contiguous from sequence zero and never rewritten. Its per-session handle exposes only `read`, `append`, `flush`, and `close`. Torn-tail truncation repairs incomplete physical writes, not committed history. There is no public replacement or deletion operation.

The inspected `Session` class exposes event access/snapshot, append, derived messages, surface generations, request headers/context, and tool history. It has no historical removal or event mutation method. `surfaceOp: {op: 'replace', ...}` remains an appended event in the authoritative log, so it cannot satisfy permanent deletion.

The JSONL README says materialization and migration publish without overwrite; released generations are retained immutable. Replacing only `session.v4.jsonl[.zstd]` would leave older generations and any other retained artifacts containing the old tail. Codec support is not an erasure transaction.

### Projection cache

`sessionProjectionCache` exposes cached views, hydration, cold snapshots, and checkpoint writes, but no public invalidate/delete/drain-for-rewrite operation. The shipped implementation binds rows to `formatVersion`, `createdAt`, `cwd`, `isSeeded`, and (for fold faces) `inheritedEventCount`. Preserving the Session id and immutable header can therefore preserve the old cache identity even after event contents change. Rows use per-projection watermarks, not a retained-prefix content hash or rewrite epoch.

Live disposal writes a final checkpoint. Cold reads can queue fail-soft, fire-and-forget checkpoint replacements. Deleting a JSON file out-of-band would not invalidate the storage domain's coherent in-memory table or already-queued writes. Old rows could seed a fold or expose deleted content/metadata unless every such path is fenced and drained. Changing the Session createdAt merely to bypass the cache is not a valid preservation of the original Session identity.

### SQLite search and prepared observations

The SQLite README states that live Sessions use connection-local TEMP tables shadowing durable base rows. Detach reveals the durable base again. Reconciliation runs on the next stable search observation and updates changed sources transactionally. That is eventual logical reconciliation, not a synchronous permanent-purge barrier for the Session's old event documents, FTS data, database freelist/WAL, and extant observation leases.

The public `sessionQuery` surface has no rewrite fence, observation revocation, purge, or durable-search erase operation. Its `observeSession` returns retained observation leases. A safe transaction needs explicit handling for in-flight readers, source revisions, and reused same-sequence values.

## Why the existing mover does not establish re-edit safety

Read only: `session-mover/mover.js` and `session-mover/index.js`.

The mover demonstrates an implementation-specific idle unload/reopen adaptation: flush, locate the lifecycle disposable via private `fiber._disposables`, detach, move a directory, invalidate selected workspace header-index maps, reopen via `controller.resolveAgent`. Its admission wrapper patches selected resolver/command/factory/query/open methods and uses async-local ownership. This is helpful evidence that normal reopening can restore a moved Session; it is not a native destructive rewrite transaction.

Important differences:

- The mover preserves the entire logical event history, so cached watermarks, exact sequences, durable child catalogs, and followed history remain meaningful. Re-edit changes that premise.
- The mover depends on private resolver/factory fields, mutable method patches, private disposal labels, and raw Cordis objects. The public Agent contract says only the holder of the original `AgentHandle` can dispose an Agent; a registry lookup exposes only a bare Agent.
- The mover deliberately creates backups and supports rollback/undo. Those mechanisms are forbidden here and cannot be reused.
- Header-only invalidation does not purge projection state, prepared observations, SQLite history, immutable old generations, independent task domains, or already-visible Client history.
- A runtime-shape check proves member existence, not coverage of every concurrent producer or the crash semantics of multi-file erasure.

The investigation therefore did not call the mover or any lifecycle action against a real Session.

## Compaction, children, timers, and rerunning

### Compaction boundaries

Compaction appends `compaction/start`, summary/provenance and replacement events, then `compaction/end`. A live unmatched bracket after the lifecycle seed is a durable lock. The replacement can shadow old user messages while retaining their raw events and source citations. A UI node's displayed content is not by itself proof of a one-to-one editable human-origin user event.

A safe implementation must reject compacted summaries, shadowed/non-own events, inherited seed ranges, unbalanced cuts, unresolved references, and unsupported event vocabularies unless the native transaction can prove and reconstruct the exact prefix. The prefix must be replay-validated, not constructed by array slicing and assumed valid. Physical Zstandard framing is a separate boundary from semantic compaction.

### Children and retained copies

The subagent manager owns activation capacity, cancellation, exact live adjacency, cold resume, and settlement. A missing parent rejects child-to-parent messages; this should not be misrepresented as automatic history cleanup. Published children have independent durable Sessions, and fork children may retain copied prefixes containing the old text. Catalog facts and completion notices have separate durable ownership. Merely unloading/reopening a parent does not prove that every child copy or late activation has been erased or fenced.

A safe initial native contract can reject all targets with active/materializing descendants or retained copies that cannot be safely accounted for. Silently deleting independent child histories is not authorized by an ambiguous parent-tail action.

### Host schedules and other activity

Schedule owns its own authoritative storage domain, one Host timer, and a FIFO spanning dispatch and task writes. It can resolve/resume a cold Session when due. Saved delivery history includes prompt snapshots. Tasks outlive Agent teardown; editing a Session log alone does not remove or suspend them. Historical log events do not reconstruct this Host domain.

A history-only deletion also must not claim to undo external effects such as previously created reminders, jobs, terminals, files, or network operations. The safest first native implementation should refuse any Session with relevant in-flight activity and unknown producers; it must define whether existing independent tasks remain, require the user to stop them, and gate them during the transaction. It cannot infer complete task provenance solely from tool/result events.

### Re-answering without a new user message

The public Agent driving APIs are `followup`, `steer`, and `inject`, all identified inbox messages. Followup and Steer wake the driver and subsequently append accepted user messages. Inject does not wake it. An empty first batch/decision makes no request. There is no public retry-from-existing-user-seq API.

Reopening a persisted cut inside a step/turn triggers the loop's interrupted-turn repair, appending synthetic closing facts. It does not establish an intentional re-edit/re-answer operation for the retained user event. Calling controller.prompt afterwards would append another user message and violate the requested behavior. Private wake/loop-state manipulation is not a safe substitute.

## Minimum native extension required

Proposed contract, not an existing API:

1. **User-only two-phase authorization and stale-state check.** Prepare an edit against exact Session id, user message id/seq, current storage revision/rewrite epoch, and original-content digest. Return the tail count and safety result without mutation. The irreversible human confirmation must cover permanent deletion, no backups/recycle bin/undo, and no rollback of files/external actions. A model must not mint its own confirmation. Revalidate on commit.
2. **One exclusive Session rewrite admission lease.** Owned by the Agent lifecycle/controller, not private monkey-patches. Reject running/waiting/compacting targets, active tool/job/terminal activity and unsupported descendants; fence prompt/steer/inject, schedule deliveries, child notifications, open/resume, queued commands, observations, persistence handles and Client follows. Drain accepted work and verify ownership; never automatically stop a running target.
3. **Native prefix and target validation.** Require one own human-origin user event, preserve its seq/message id and intended pre-target events, replace only its editable content, and retain valid attachment/source semantics. Reject summaries, inherited/compacted/shadowed boundaries or ambiguous open lifecycle states unless supported. Reconstruct through the owning codec and replay validators. Do not invent user events or replace private arrays.
4. **Durable permanent replacement transaction.** The backend owns locks across processes and crash recovery. Publish a validated replacement containing only the retained prefix plus edited target, with a new rewrite epoch/revision. Permanently retire all superseded canonical generations and temporary/staged artifacts without preserving the old tail as a log, backup or recovery copy. Define restart/crash behavior at every commit boundary. An unfinished transaction must not expose old history as success. Storage-device forensic overwrite is a separate guarantee and must not be promised without explicit support.
5. **Derived-state erase/invalidation barrier.** Drain/revoke old prepared observations and pending checkpoint writes; delete/rebuild projection rows and in-memory folds; purge durable/TEMP/FTS query rows and define WAL/freelist cleanup; invalidate header/persistence memos and all same-sequence Client data. Reset stream subscribers with an explicit rewrite epoch and full replacement baseline. No previously leased generation may reinsert old rows after commit.
6. **Explicit existing-message answer continuation.** Resume using the edited event as already-admitted input and schedule a new model request through normal loop ownership without another user message. Re-establish valid turn/step/header/model selection state and a fresh request series where needed. Report edit-committed/answer-start-failed honestly; do not claim success before durable erasure.
7. **Isolation tests and failure injection.** Prove raw and Zstandard paths, immutable predecessor removal, reboot/reopen, same-seq cache reuse, SQLite reconciliation and physical retention policy, stale confirmations, duplicate commits, cross-process ownership, in-flight readers/writers, compaction brackets, descendants/schedules, Client multi-window reset, and no-duplicate-user rerun using synthetic fixtures only.

A single native `reeditAndAnswer` operation plus a read-only prepare surface could own those steps. Exact naming is intentionally not proposed as if it already existed.

## Verification and limits

- Verified current public API signatures through Cordis inspect; inspected shipped package documentation, the cache implementation, and existing mover source read-only.
- No private runtime fields were patched. No Session folder or profile storage was enumerated or changed. No backup, recycle item, or undo record was created.
- No permanent truncation, restart recovery, codec roundtrip, cache purge, search erasure, concurrency, or answer generation was tested, because no safe implementation was selected. A mock fixture would not prove the missing Host transaction.
- No Client slot contract, message editor, confirmation modal, localization display, icon rendering, or live GUI integration was verified.
- No installable bundle/package/patch/Host/Client/icon assets were created. This is deliberately an assessment, not a completed feature.

## Evidence locations

All installed paths below are inside the stated runtime root and were read with the Host file-read tool.

- `node_modules/@deepseek-ai/dsh-session-persistence-jsonl/README.md`: lines 55-91 (physical generations, durability, migration), 107-111 (codec and memo ownership), 167-171 (no deletion API and cross-process writer locks).
- `node_modules/@deepseek-ai/dsh-session-persistence-jsonl/package.json`: lines 14-29 (public exports/shipped resources), version line 4.
- `node_modules/@deepseek-ai/dsh-session-projection-cache/README.md`: lines 55-67 (checkpoint lifecycle/identity), 127-129 (no retention surface).
- `node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js`: lines 34-64 (identity), 135-171 (coherent table), 247-269 (hydrate/write).
- `node_modules/@deepseek-ai/dsh-session-query-sqlite/README.md`: lines 85-108 (derived SQLite observation and TEMP/base reconciliation).
- `node_modules/@deepseek-ai/dsh-api-session-controller/README.md`: lines 30-36 (prompt/history/access), 54-69 (follow/stream/paging), 75 (independent activity owners).
- `node_modules/@deepseek-ai/dsh-agent/README.md`: lines 32-47 (handles and driving APIs), 83-91 (admission/inbox), 115-117 (disposer capability), 141-143 (empty first decision).
- `node_modules/@deepseek-ai/dsh-agent-loop/README.md`: lines 108-120 (lifecycle, persistence repair, turn flow).
- `node_modules/@deepseek-ai/dsh-compaction-basic/README.md`: lines 104-125 (brackets, replacement provenance, live lock).
- `node_modules/@deepseek-ai/dsh-schedule/README.md`: lines 47-77 (independent authoritative tasks, FIFO, cold delivery, saved snapshots).
- `node_modules/@deepseek-ai/dsh-subagent/README.md`: lines 117-138 (settlement/catalog/ownership), 207-210 (missing-parent behavior and process-local residency).
- Workspace `session-mover/mover.js`: lines 64-122 (patched admission), 124-159 (private lifecycle unload/reopen), 203-245 (flush/unload/storage move), 265-291 (backup rollback).
- Workspace `session-mover/index.js`: lines 120-139 (header rewrite), 153-173 (workspace header maps only).
