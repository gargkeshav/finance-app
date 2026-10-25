# Project Agent Instructions

## Authority And Scope

- Read IMPLEMENTATION_PLAN.md before changing application behavior. Financial invariants are acceptance requirements, not suggestions.
- Work within the current stage. Do not build encryption, vaults, scheduled backups, sync, mobile, AI categorization, or reusable historical spreadsheet importers in V1.
- Respect existing user changes. No commits, branches, destructive resets, or private-data uploads without explicit permission.
- Use established, maintained parsers and libraries. Do not hand-roll CSV parsing, money rounding, cryptography, or external authentication protocols.

## Lead And Subagents

- Use a high-capability reasoning/coding model as the lead for financial semantics, schema, contracts, matching decisions, cross-module integration, security-sensitive work, and final review.
- Use lower-cost models for bounded tasks such as a specified CSV adapter, synthetic fixture creation, isolated UI states, documentation, or test implementation against an approved contract.
- Model availability and pricing depend on the host. Select models explicitly only when supported and known. If model selection is unavailable, use subagent context isolation without claiming cost savings. Escalate ambiguous work to the lead.
- Delegate independent tasks where useful, not merely to increase agent count. Review agents should not write the implementation they independently assess.
- Parallelize only work with independent file ownership and stable contracts. Schema, bridge, money/date types, and core accounting have one coordinating owner.
- Before delegation specify objective, owned files, permitted dependencies, input/output contract, exclusions, fixtures, executable test command, and required completion evidence.
- Require each result to list changed files, assumptions, executed checks and results, unrun checks, risks, and integration notes. The lead must inspect changes and rerun relevant checks; a subagent's assertion is not release evidence.
- Escalate failed tests, ambiguous matching, financial-rule changes, or shared-file conflicts rather than relaxing acceptance criteria. Use a more capable agent when the task exceeds the assigned model's reliability.

## Implementation Discipline

- Establish a local hypothesis, make a small change, and run the cheapest relevant executable check immediately. Integrate in vertical slices rather than generating the whole application at once.
- Keep TypeScript finance logic independent of React, Tauri, storage, and network APIs. Validate all untrusted input at boundaries.
- Store AUD money in integer cents; reject unsafe or invalid representations. Store date-only bank dates without timezone conversion. Never use floating-point arithmetic for financial amounts.
- Keep source evidence immutable. Record user edits, automated decisions, provenance, locks, and explicit reversals. Never silently overwrite a manual decision.
- Persist complete commands atomically, including audit effects. Reject stale writes using record versions or equivalent optimistic concurrency protection.
- Use a small allowlisted native bridge with validated requests. Do not expose arbitrary SQL, arbitrary filesystem access, or secrets to general UI components.
- Keep external side effects behind explicit confirmation. Unknown Splitwise write outcomes must be reconciled before retrying.
- Never send personal financial data to remote AI, telemetry, or external services except the explicitly selected Splitwise payload after consent. Redact sensitive logs and errors.
- Commit only synthetic fixtures. Keep live databases, exports, statements, credentials, and personal reference files out of version control.

## UX And Completion

- Follow the UI contract in IMPLEMENTATION_PLAN.md. Prefer a working minimal workflow over decorative dashboards or explanatory landing pages.
- Provide accessible labels, keyboard operation, visible focus, readable amounts, explicit loading/error/empty states, and recoverable errors.
- Do not treat browser tests as proof of Tauri or SQLite behavior. Run native persistence, restart, rollback, restore, and packaged-app checks.
- Deliver exact setup/run/test commands, a requirement-to-test matrix, known limitations, and a verification report. Never claim unexecuted checks passed.
- The independent verifier uses VERIFICATION.md against the implementation and reports severity-ranked findings. Final acceptance requires resolution or explicit user acceptance of outstanding risks.