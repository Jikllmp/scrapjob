# ADR 0003 — Enforcing "no field without evidence" in SQLite

Status: accepted (Phase 1)

Spec §2.3 asks for a database constraint, not just a code convention. SQLite has no cross-table `CHECK` and no
commit-time triggers, so the rule is enforced by three triggers (`apps/api/drizzle/0001_evidence_triggers.sql`):

1. `contacts_insert_must_be_empty`: a contact is inserted with every evidence-backed field `NULL`.
2. `contacts_fields_require_evidence`: an `UPDATE` that leaves any of those fields non-null fails unless an
   `evidence` row exists for that contact and that field. `company_id` is backed by evidence with `field = 'company'`.
3. `evidence_last_row_protected`: the last evidence row of a populated field cannot be deleted. Erasing the whole
   contact still cascades.

The write sequence is therefore: insert an empty contact, insert its evidence rows, then set the fields, all in one
transaction. The repository layer (Phase 2) adds the same assertion in TypeScript so that the error is caught before
reaching the database. `apps/api/test/evidence-triggers.test.ts` covers each trigger.
