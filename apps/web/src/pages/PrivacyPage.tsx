import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { getPrivacy } from '../lib/api';

interface Props {
  onLogSearch: (searchId: string | null, follow: boolean) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-1 text-sm text-neutral-700">{children}</div>
    </section>
  );
}

/** The transparency notice of spec §2.2 (GDPR Art. 14), with what this copy holds right now. */
export function PrivacyPage({ onLogSearch }: Props) {
  useEffect(() => onLogSearch(null, false), [onLogSearch]);
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: getPrivacy });
  const days = privacy.data?.retentionDays;

  return (
    <article className="max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Privacy</h1>
        <p className="text-sm text-neutral-600">
          This tool collects personal data about people who did not ask to be in it. This page says what it keeps, why, and how anyone in it
          can object. The full notice, with a template to include in your first message, is <code>PRIVACY.md</code> in the repository.
        </p>
      </header>

      {privacy.data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-neutral-200 bg-white p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-500">Contacts held</dt>
            <dd className="tabular-nums">{privacy.data.contacts}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Oldest collected</dt>
            <dd>{privacy.data.oldestCollectedAt?.slice(0, 10) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Deleted after</dt>
            <dd>{days} days</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Erasure blocklist</dt>
            <dd className="tabular-nums">{privacy.data.blocklistEntries} entries</dd>
          </div>
        </dl>
      )}

      <Section title="Who is responsible">
        <p>
          The person running this copy of the tool is the controller of the data it collects. It is meant for one person's own job search; it
          is not a service and shares nothing with anyone.
        </p>
      </Section>

      <Section title="Purpose and lawful basis">
        <p>
          The only purpose is to find people to contact about a job: recruiters, hiring managers and team leads at employers in the area the
          user searches. The lawful basis is legitimate interest (GDPR Art. 6(1)(f)); the balancing test is written down in{' '}
          <code>docs/LIA.md</code>.
        </p>
      </Section>

      <Section title="What is collected">
        <p>Professional identity only: name, job title, employer, work location, a work email or phone number the person or their employer published, and a public professional profile URL.</p>
        <p>
          Never collected: personal email or phone, home address, date of birth, photos, nationality, gender, family status, or anything in
          the special categories of Art. 9. An email address is stored only if that exact address was published; none is ever guessed from a
          naming pattern.
        </p>
      </Section>

      <Section title="Where it comes from">
        <p>
          Employer websites (team, about and contact pages, read only where robots.txt allows it), public job feeds of employers, the Belgian
          business register (KBO/BCE open data, companies only), press releases and conference speaker pages, and the titles and snippets a
          web search engine returns for public professional profiles. Pages behind a login are never read, and LinkedIn pages are never
          fetched. Every stored field links to the page it was seen on.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Contacts are deleted automatically {days ?? 'a fixed number of'} days after they were collected (<code>DATA_RETENTION_DAYS</code>). The
          spreadsheets the tool generates say the same date on their first sheet. Everything can be deleted at once with{' '}
          <code>pnpm data:purge -- --all</code>, or one search with <code>pnpm data:purge -- --search &lt;id&gt;</code>.
        </p>
      </Section>

      <Section title="How to object or ask for erasure">
        <p>
          Anyone who finds themselves in this data can ask the user who contacted them to delete it. The Delete button on each contact removes
          the person, every piece of evidence about them and the spreadsheets that contained them, and puts their name and employer on a
          blocklist so that later searches never add them again. The blocklist keeps only a normalised name and the employer's domain.
        </p>
        <p>People also have the right to complain to their data protection authority (in Belgium, the Autorité de protection des données).</p>
      </Section>
    </article>
  );
}
