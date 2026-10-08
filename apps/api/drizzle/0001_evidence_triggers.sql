-- No contact field may exist without evidence (spec §2.3, docs/ADR/0003-evidence-enforcement.md).
-- A contact is inserted as an empty shell; its fields are set by UPDATE once evidence rows exist.
CREATE TRIGGER contacts_insert_must_be_empty
BEFORE INSERT ON contacts
WHEN NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL OR NEW.full_name IS NOT NULL OR NEW.title IS NOT NULL OR NEW.department IS NOT NULL OR NEW.profile_url IS NOT NULL OR NEW.email IS NOT NULL OR NEW.phone IS NOT NULL OR NEW.city IS NOT NULL OR NEW.country IS NOT NULL OR NEW.company_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'EVIDENCE_REQUIRED: insert the contact empty, add evidence, then set its fields');
END;
--> statement-breakpoint
CREATE TRIGGER contacts_fields_require_evidence
BEFORE UPDATE ON contacts
WHEN (NEW.first_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'first_name'))
  OR (NEW.last_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'last_name'))
  OR (NEW.full_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'full_name'))
  OR (NEW.title IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'title'))
  OR (NEW.department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'department'))
  OR (NEW.profile_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'profile_url'))
  OR (NEW.email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'email'))
  OR (NEW.phone IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'phone'))
  OR (NEW.city IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'city'))
  OR (NEW.country IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'country'))
  OR (NEW.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evidence WHERE contact_id = NEW.id AND field = 'company'))
BEGIN
  SELECT RAISE(ABORT, 'EVIDENCE_REQUIRED: a contact field has no evidence row');
END;
--> statement-breakpoint
CREATE TRIGGER evidence_last_row_protected
BEFORE DELETE ON evidence
WHEN OLD.contact_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.contact_id = OLD.contact_id AND e.field = OLD.field AND e.id <> OLD.id)
  AND EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = OLD.contact_id AND (
  (OLD.field = 'first_name' AND c.first_name IS NOT NULL)
  OR (OLD.field = 'last_name' AND c.last_name IS NOT NULL)
  OR (OLD.field = 'full_name' AND c.full_name IS NOT NULL)
  OR (OLD.field = 'title' AND c.title IS NOT NULL)
  OR (OLD.field = 'department' AND c.department IS NOT NULL)
  OR (OLD.field = 'profile_url' AND c.profile_url IS NOT NULL)
  OR (OLD.field = 'email' AND c.email IS NOT NULL)
  OR (OLD.field = 'phone' AND c.phone IS NOT NULL)
  OR (OLD.field = 'city' AND c.city IS NOT NULL)
  OR (OLD.field = 'country' AND c.country IS NOT NULL)
  OR (OLD.field = 'company' AND c.company_id IS NOT NULL)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'EVIDENCE_REQUIRED: cannot delete the last evidence row of a populated field');
END;
