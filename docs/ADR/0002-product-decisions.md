# ADR 0002 — Product decisions from Phase 0

Status: accepted by Soufiane on 2026-10-08

1. **Unconfirmed leads count toward the target.** A contact whose only support is a `LOW`-confidence source (typically
   a LinkedIn title seen in search results) is kept, labelled as an unconfirmed lead in the table and the export, and
   counts toward `targetCount`. The counter shows confirmed and leads separately.
2. **Brave Search only** (see ADR 0001).
3. **Documentation and code stay in English.** Conversation with the user is in French.
4. All other defaults in `docs/ANALYSIS.md` §2 and §4 apply.
