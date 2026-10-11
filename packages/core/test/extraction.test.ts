import { describe, expect, it } from 'vitest';
import {
  emailsInText,
  isGenericMailbox,
  looksLikePersonName,
  normaliseName,
  normaliseProfileUrl,
  parseLinkedInResult,
  parsePage,
  registrableDomain,
  slugify,
  snippetAround,
  valueInSnippet,
} from '../src';
import { taxonomy } from './helpers';

describe('parseLinkedInResult', () => {
  const url = 'https://be.linkedin.com/in/marie-dupont-123';
  it.each([
    ['Marie Dupont - Talent Acquisition Specialist - Acme | LinkedIn', { fullName: 'Marie Dupont', title: 'Talent Acquisition Specialist', companyName: 'Acme' }],
    ['Marie Dupont – Recruteuse IT chez Acme | LinkedIn', { fullName: 'Marie Dupont', title: 'Recruteuse IT', companyName: 'Acme' }],
    ['Marie Dupont - Acme | LinkedIn', { fullName: 'Marie Dupont', title: null, companyName: 'Acme' }],
    ['Jean-Marc Van der Berg - IT Recruiter at Globex - LinkedIn', { fullName: 'Jean-Marc Van der Berg', title: 'IT Recruiter', companyName: 'Globex' }],
  ])('%s', (title, expected) => {
    expect(parseLinkedInResult(url, title, taxonomy)).toEqual(expected);
  });

  it('ignores company pages, posts and job pages', () => {
    for (const u of ['https://www.linkedin.com/company/acme', 'https://www.linkedin.com/posts/x', 'https://www.linkedin.com/jobs/view/1']) {
      expect(parseLinkedInResult(u, 'Marie Dupont - Recruiter - Acme | LinkedIn', taxonomy)).toBeNull();
    }
  });

  it('ignores results whose first part is not a name', () => {
    expect(parseLinkedInResult(url, '10 tips for recruiters | LinkedIn', taxonomy)).toBeNull();
  });
});

describe('parsePage', () => {
  const html = `<!doctype html><html><head><title>Notre équipe — Acme Software</title>
    <meta property="og:site_name" content="Acme Software">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Luc Martin","jobTitle":"CTO","email":"mailto:luc.martin@acme.be"}</script>
    </head><body>
    <h1>Notre équipe</h1>
    <div class="team">
      <div class="card"><h3>Marie Dupont</h3><p>Talent Acquisition Manager</p>
        <a href="https://www.linkedin.com/in/marie-dupont">LinkedIn</a><span>marie.dupont@acme.be</span></div>
      <div class="card"><h3>Paul Durand</h3><p>Comptable</p></div>
      <div class="card"><h3>Notre Histoire</h3><p>Responsable RH depuis toujours</p></div>
    </div>
    <p>Écrivez-nous : jobs@acme.be</p>
    <a href="/carrieres">Carrières</a>
    </body></html>`;
  const page = parsePage(html, 'https://www.acme.be/equipe', taxonomy);

  it('finds people next to hiring-relevant titles only', () => {
    expect(page.people.map((p) => [p.fullName, p.title])).toEqual([
      ['Marie Dupont', 'Talent Acquisition Manager'],
      ['Luc Martin', 'CTO'],
    ]);
  });

  it('keeps every value inside its snippet', () => {
    for (const p of page.people) {
      expect(valueInSnippet(p.fullName, p.nameSnippet)).toBe(true);
      if (p.title) expect(valueInSnippet(p.title, p.titleSnippet!)).toBe(true);
      if (p.email) expect(valueInSnippet(p.email, p.emailSnippet!)).toBe(true);
      if (p.profileUrl) expect(valueInSnippet(p.profileUrl, p.profileSnippet!)).toBe(true);
    }
  });

  it('takes only published personal work emails and profile links', () => {
    const marie = page.people[0]!;
    expect(marie.email).toBe('marie.dupont@acme.be');
    expect(marie.profileUrl).toBe('https://www.linkedin.com/in/marie-dupont');
    expect(page.genericEmails).toEqual(['jobs@acme.be']);
  });

  it('resolves links and reads the site name', () => {
    expect(page.siteName).toBe('Acme Software');
    expect(page.links).toContainEqual({ href: 'https://www.acme.be/carrieres', text: 'Carrières' });
  });

  it('finds the named contact on a job posting', () => {
    const posting = parsePage(
      '<html><body><h1>Développeur .NET</h1><p>Personne de contact : Sophie Lambert</p></body></html>',
      'https://acme.be/jobs/dotnet',
      taxonomy,
    );
    expect(posting.people).toMatchObject([{ fullName: 'Sophie Lambert', postingContact: true }]);
  });

  it('survives malformed HTML and JSON-LD', () => {
    const broken = parsePage(
      '<html><head><script type="application/ld+json">{nope</script></head><body><div><h3>Marie Dupont</h3><p>IT Recruiter<div><span>',
      'https://x.be/',
      taxonomy,
    );
    expect(broken.people.map((p) => p.fullName)).toEqual(['Marie Dupont']);
  });
});

describe('text helpers', () => {
  it('normalises names for dedup', () => {
    expect(normaliseName('Dupont, Marie-Hélène')).toBe(normaliseName('marie helene DUPONT'));
  });

  it('normalises LinkedIn profile URLs', () => {
    expect(normaliseProfileUrl('https://be.linkedin.com/in/Marie-Dupont/?trk=x#a')).toBe('https://linkedin.com/in/marie-dupont');
  });

  it('computes registrable domains', () => {
    expect(registrableDomain('https://jobs.acme.be/x')).toBe('acme.be');
    expect(registrableDomain('shop.acme.co.uk')).toBe('acme.co.uk');
  });

  it('slugifies safely', () => {
    expect(slugify('../../Développeur .NET')).toBe('developpeur-net');
    expect(slugify('***')).toBe('x');
  });

  it('recognises names', () => {
    expect(looksLikePersonName('Jean-Marc Van der Berg')).toBe(true);
    expect(looksLikePersonName('Notre Équipe')).toBe(false);
    expect(looksLikePersonName('Contact Us')).toBe(false);
    expect(looksLikePersonName('marie dupont')).toBe(false);
  });

  it('tells personal from role mailboxes', () => {
    expect(isGenericMailbox('jobs@acme.be')).toBe(true);
    expect(isGenericMailbox('rh.charleroi@acme.be')).toBe(true);
    expect(isGenericMailbox('marie.dupont@acme.be')).toBe(false);
    expect(emailsInText('Mail marie@acme.be.')).toEqual(['marie@acme.be']);
  });

  it('builds snippets that contain the value', () => {
    const long = `${'a '.repeat(400)}Marie Dupont ${'b '.repeat(400)}`;
    const s = snippetAround(long, 'Marie Dupont')!;
    expect(s.length).toBeLessThanOrEqual(500);
    expect(s).toContain('Marie Dupont');
    expect(snippetAround('abc', 'zzz')).toBeNull();
  });
});
