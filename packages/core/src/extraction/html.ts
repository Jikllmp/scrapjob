import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { Taxonomy } from '../taxonomy';
import { classifyTitle } from '../contacts/roles';
import { collapseWhitespace } from '../text/normalise';
import { emailsInText, isGenericMailbox } from './email';
import { looksLikePersonName } from './names';
import { clip, snippetAround } from './snippet';

export interface PageLink {
  href: string;
  text: string;
}

export interface PagePerson {
  fullName: string;
  nameSnippet: string;
  title: string | null;
  titleSnippet: string | null;
  email: string | null;
  emailSnippet: string | null;
  profileUrl: string | null;
  profileSnippet: string | null;
  postingContact: boolean;
}

export interface JobPostingInfo {
  title: string;
  hiringOrganization: string | null;
  datePosted: string | null;
  location: string | null;
}

export interface ParsedPage {
  url: string;
  title: string;
  siteName: string | null;
  /** Visible text with whitespace collapsed. */
  text: string;
  links: PageLink[];
  people: PagePerson[];
  genericEmails: string[];
  jobPostings: JobPostingInfo[];
  publishedAt: string | null;
  /** `<meta name="robots" content="noindex">`: the site asks not to be indexed. */
  noindex: boolean;
}

const blockTags = 'h1,h2,h3,h4,h5,h6,p,span,strong,b,em,div,li,a,td,th,figcaption,dt,dd';
const postingContactPattern =
  /(?:[Pp]ersonne de contact|[Cc]ontact person|[Cc]ontactpersoon|[Vv]otre recrut(?:eur|euse)|[Yy]our recruiter|[Uu]w recruiter|[Cc]ontact)\s*:\s*(\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:van|de|der|den|du|le|la|von)\s+)*\p{Lu}[\p{L}'’-]*))/gu;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function* walkJson(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walkJson(n);
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    yield obj;
    for (const v of Object.values(obj)) yield* walkJson(v);
  }
}

function hasType(obj: Record<string, unknown>, type: string): boolean {
  const t = obj['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

/** Parses a fetched HTML page into the facts adapters need. Every value it returns is present in the page. */
export function parsePage(html: string, url: string, taxonomy: Taxonomy): ParsedPage {
  const $ = cheerio.load(html);
  const jsonLdScripts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get();
  $('script, style, noscript, template, svg').remove();
  // Element boundaries become spaces, so adjacent elements never glue words together.
  $('body *').each((_, el) => {
    $(el).prepend(' ').append(' ');
  });

  const text = collapseWhitespace($('body').text());
  const title = collapseWhitespace($('title').first().text());
  const siteName = $('meta[property="og:site_name"]').attr('content')?.trim() || null;
  const noindex = /noindex|none/i.test($('meta[name="robots" i]').attr('content') ?? '');

  const links: PageLink[] = [];
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href') ?? '';
    try {
      const abs = new URL(raw, url);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') {
        abs.hash = '';
        links.push({ href: abs.toString(), text: collapseWhitespace($(el).text()) });
      }
    } catch {
      // ignore malformed links
    }
  });

  const people = new Map<string, PagePerson>();
  const addPerson = (p: PagePerson) => {
    const key = p.fullName.toLowerCase();
    const existing = people.get(key);
    if (!existing) people.set(key, p);
    else {
      existing.title ??= p.title;
      existing.titleSnippet ??= p.titleSnippet;
      existing.email ??= p.email;
      existing.emailSnippet ??= p.emailSnippet;
      existing.profileUrl ??= p.profileUrl;
      existing.profileSnippet ??= p.profileSnippet;
      existing.postingContact ||= p.postingContact;
    }
  };

  // 1. Team cards: a name-like element next to a hiring-relevant title.
  $('body')
    .find(blockTags)
    .each((_, el) => {
      const node = $(el);
      if (node.children(blockTags).filter((_, c) => collapseWhitespace($(c).text()).length > 0).length > 0) return;
      const name = collapseWhitespace(node.text());
      if (!looksLikePersonName(name)) return;
      const card = findCard($, el);
      const cardText = collapseWhitespace(card.text());
      if (cardText.length > 600) return;
      const title = findTitleNear($, card, name, taxonomy);
      if (!title) return;
      const nameSnippet = snippetAround(cardText, name);
      if (!nameSnippet) return;
      const person: PagePerson = {
        fullName: name,
        nameSnippet,
        title,
        titleSnippet: snippetAround(cardText, title),
        email: null,
        emailSnippet: null,
        profileUrl: null,
        profileSnippet: null,
        postingContact: false,
      };
      const email = emailsInText(cardText).find((e) => !isGenericMailbox(e));
      if (email) {
        person.email = email;
        person.emailSnippet = snippetAround(cardText, email);
      }
      card.find('a[href*="linkedin.com/in/"]').each((_, a) => {
        if (person.profileUrl) return;
        person.profileUrl = $(a).attr('href') ?? null;
        person.profileSnippet = clip($.html(a));
      });
      addPerson(person);
    });

  // 2. JSON-LD Person objects with a job title.
  const jobPostings: JobPostingInfo[] = [];
  let publishedAt = isoOrNull($('meta[property="article:published_time"]').attr('content'));
  for (const raw of jsonLdScripts) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const obj of walkJson(data)) {
      publishedAt ??= isoOrNull(obj.datePublished);
      if (hasType(obj, 'Person') && typeof obj.name === 'string' && typeof obj.jobTitle === 'string') {
        const nameSnippet = snippetAround(raw, obj.name);
        const titleSnippet = snippetAround(raw, obj.jobTitle);
        if (nameSnippet && titleSnippet && looksLikePersonName(obj.name) && classifyTitle(obj.jobTitle, taxonomy)) {
          const email = typeof obj.email === 'string' ? obj.email.replace(/^mailto:/, '') : null;
          const usableEmail = email && !isGenericMailbox(email) ? email : null;
          addPerson({
            fullName: collapseWhitespace(obj.name),
            nameSnippet,
            title: collapseWhitespace(obj.jobTitle),
            titleSnippet,
            email: usableEmail,
            emailSnippet: usableEmail ? snippetAround(raw, usableEmail) : null,
            profileUrl: null,
            profileSnippet: null,
            postingContact: false,
          });
        }
      }
      if (hasType(obj, 'JobPosting') && typeof obj.title === 'string') {
        const org = obj.hiringOrganization as Record<string, unknown> | undefined;
        const place = obj.jobLocation as Record<string, unknown> | undefined;
        const address = place?.address as Record<string, unknown> | undefined;
        jobPostings.push({
          title: collapseWhitespace(obj.title),
          hiringOrganization: typeof org?.name === 'string' ? org.name : null,
          datePosted: isoOrNull(obj.datePosted),
          location: typeof address?.addressLocality === 'string' ? address.addressLocality : null,
        });
      }
    }
  }

  // 3. A named contact on a job posting ("Personne de contact : Marie Dupont").
  for (const match of text.matchAll(postingContactPattern)) {
    const name = match[1]!.trim();
    if (!looksLikePersonName(name)) continue;
    const nameSnippet = snippetAround(text, match[0]);
    if (!nameSnippet) continue;
    addPerson({
      fullName: name,
      nameSnippet,
      title: null,
      titleSnippet: null,
      email: null,
      emailSnippet: null,
      profileUrl: null,
      profileSnippet: null,
      postingContact: true,
    });
  }

  const genericEmails = emailsInText(text).filter(isGenericMailbox);
  return { url, title, siteName, text, links, people: [...people.values()], genericEmails, jobPostings, publishedAt, noindex };
}

/**
 * The block holding one person: the largest ancestor (up to three levels) that
 * still contains only this one name. Climbing further would mix people up.
 */
function findCard($: cheerio.CheerioAPI, el: Element): cheerio.Cheerio<Element> {
  const isNameLeaf = (_: number, node: Element) => {
    const n = $(node);
    if (n.children(blockTags).filter((__, c) => collapseWhitespace($(c).text()).length > 0).length > 0) return false;
    return looksLikePersonName(collapseWhitespace(n.text()));
  };
  let card = $(el).parent();
  for (let depth = 0; depth < 3; depth += 1) {
    const parent = card.parent();
    if (parent.length === 0 || parent.is('body')) return card;
    if (parent.find(blockTags).filter(isNameLeaf).length > 1) return card;
    if (collapseWhitespace(card.text()).length > 40) return card;
    card = parent;
  }
  return card;
}

function findTitleNear(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<Element>,
  name: string,
  taxonomy: Taxonomy,
): string | null {
  let found: string | null = null;
  card.find(blockTags).each((_, el) => {
    if (found) return;
    const node = $(el);
    if (node.children(blockTags).length > 0) return;
    const value = collapseWhitespace(node.text());
    if (!value || value === name || value.length > 100) return;
    if (classifyTitle(value, taxonomy)) found = value;
  });
  return found;
}
