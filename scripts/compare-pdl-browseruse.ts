/**
 * Compare PDL vs Browser-Use enrichment — both starting from name + company domain ONLY.
 *
 * - PDL: person enrich API (name + company)
 * - Browser-Use: LinkedIn search by name + company (no URL given), then scrape profile
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/compare-pdl-browseruse.ts [--sample N]
 */

import * as fs from 'fs';

const PDL_API_BASE = 'https://api.peopledatalabs.com/v5';
const BROWSER_USE_URL = process.env.BROWSER_USE_URL || 'http://localhost:8100';

interface Contact {
  id: string;
  full_name: string;
  title: string | null;
  company_domain: string | null;
  employer_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
}

interface PDLResult {
  found: boolean;
  fullName: string | null;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  workEmail: string | null;
  mobilePhone: string | null;
  location: string | null;
  likelihood: number | null;
  error?: string;
}

interface BrowserUseResult {
  found: boolean;
  name: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  headline: string | null;
  location: string | null;
  profileUrl: string | null;
  experiences: any[];
  education: any[];
  error?: string;
  reason?: string;
  durationMs?: number;
}

interface ComparisonRow {
  contact: { name: string; title: string | null; employer: string | null; domain: string | null; knownLinkedin: string | null };
  pdl: PDLResult;
  browserUse: BrowserUseResult;
  agreement: {
    nameMatch: boolean | null;
    titleMatch: boolean | null;
    companyMatch: boolean | null;
  };
  validation: {
    pdlTitleMatchesKnown: boolean | null;
    buTitleMatchesKnown: boolean | null;
    pdlLinkedinMatchesKnown: boolean | null;
    buLinkedinMatchesKnown: boolean | null;
  };
}

// ── PDL Enrichment ─────────────────────────────────────────────────────────

async function enrichPDL(name: string, domain: string): Promise<PDLResult> {
  const apiKey = process.env.PDL_API_KEY || process.env.PEOPLEDATALABS_API_KEY;
  if (!apiKey) return emptyPDL('No API key');

  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');

  const companyFromDomain = domain
    .replace(/^www\./i, '')
    .replace(/\.(com|org|net|io|co|ai|app|dev)$/i, '')
    .replace(/[-_]/g, ' ');

  const params = new URLSearchParams({
    first_name: firstName,
    last_name: lastName,
    company: companyFromDomain,
    min_likelihood: '5',
    pretty: 'true',
    titlecase: 'true',
  });

  try {
    const res = await fetch(`${PDL_API_BASE}/person/enrich?${params}`, {
      headers: { 'X-Api-Key': apiKey },
    });

    if (res.status === 404) return emptyPDL();
    if (res.status === 402) return emptyPDL('Insufficient credits');
    if (res.status === 400) return emptyPDL('Bad request (missing required fields)');
    if (!res.ok) {
      const text = await res.text();
      return emptyPDL(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const person = data.data || data;

    const emails: any[] = Array.isArray(person.emails) ? person.emails : [];
    const profEmail = emails.find((e: any) => e.type === 'professional')?.address || null;

    let linkedinUrl = person.linkedin_url || null;
    if (linkedinUrl && !linkedinUrl.startsWith('http')) {
      linkedinUrl = `https://${linkedinUrl}`;
    }

    return {
      found: true,
      fullName: person.full_name || null,
      title: person.job_title || null,
      company: person.job_company_name || null,
      companyDomain: person.job_company_website || null,
      linkedinUrl,
      workEmail: person.work_email || profEmail || null,
      mobilePhone: person.mobile_phone || null,
      location: person.location_name || null,
      likelihood: data.likelihood || null,
    };
  } catch (err) {
    return emptyPDL(err instanceof Error ? err.message : String(err));
  }
}

function emptyPDL(error?: string): PDLResult {
  return { found: false, fullName: null, title: null, company: null, companyDomain: null, linkedinUrl: null, workEmail: null, mobilePhone: null, location: null, likelihood: null, error };
}

// ── Browser-Use LinkedIn Search + Scrape ─────────────────────────────────

async function searchLinkedIn(name: string, company: string): Promise<BrowserUseResult> {
  const empty: BrowserUseResult = { found: false, name: null, currentTitle: null, currentCompany: null, headline: null, location: null, profileUrl: null, experiences: [], education: [] };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    const res = await fetch(`${BROWSER_USE_URL}/api/linkedin/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, company, timeout_ms: 150_000 }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      return { ...empty, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const result = await res.json();
    const profile = result.data || result;

    return {
      found: result.success && !!(profile.name || profile.currentTitle || profile.currentCompany),
      name: profile.name || null,
      currentTitle: profile.currentTitle || null,
      currentCompany: profile.currentCompany || null,
      headline: profile.headline || null,
      location: profile.location || null,
      profileUrl: profile.profileUrl || null,
      experiences: profile.experiences || [],
      education: profile.education || [],
      reason: result.reason,
      durationMs: result.durationMs,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Fuzzy matching helpers ─────────────────────────────────────────────────

function normalize(s: string | null | undefined): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
}

function fuzzyMatch(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a && !b) return null;
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function linkedinSlugMatch(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a && !b) return null;
  if (!a || !b) return false;
  const slugA = a.replace(/.*linkedin\.com\/in\//i, '').replace(/\/.*/, '').replace(/%.*/, '').toLowerCase();
  const slugB = b.replace(/.*linkedin\.com\/in\//i, '').replace(/\/.*/, '').replace(/%.*/, '').toLowerCase();
  if (!slugA || !slugB) return false;
  return slugA === slugB;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let sampleSize = 20;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i + 1]) sampleSize = parseInt(args[i + 1]);
  }

  const contacts: Contact[] = JSON.parse(fs.readFileSync('/Users/remy/Downloads/contacts.json', 'utf8'));

  // Both sources start from name + company domain only
  // We keep known linkedin_url for VALIDATION only (not given to either source)
  const candidates = contacts.filter(c =>
    c.full_name &&
    c.full_name.trim().split(/\s+/).length >= 2 &&
    c.company_domain &&
    c.employer_name
  );

  console.log(`Total contacts: ${contacts.length}`);
  console.log(`Candidates with name + domain: ${candidates.length}`);

  // Random sample
  const shuffled = candidates.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);

  console.log(`Sample size: ${sample.length}`);
  console.log(`\nApproach (FAIR — neither source gets LinkedIn URL):`);
  console.log(`  PDL: enrich by name + company domain`);
  console.log(`  BrowserUse: search LinkedIn by name + company, find & scrape profile`);
  console.log(`  Known LinkedIn URL used ONLY for validation.\n`);
  console.log('='.repeat(110));

  const results: ComparisonRow[] = [];
  const startTime = Date.now();

  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n[${i + 1}/${sample.length}] (${elapsed}m) ${c.full_name} -- ${c.title || '?'} @ ${c.employer_name}`);
    console.log(`  Input: name="${c.full_name}" company="${c.employer_name}" domain=${c.company_domain}`);
    if (c.linkedin_url) console.log(`  Known LinkedIn (for validation only): ${c.linkedin_url}`);

    // Step 1: PDL enrich (fast, ~1s)
    const pdl = await enrichPDL(c.full_name, c.company_domain!);

    // Step 2: Browser-Use search LinkedIn by name + company (slow, ~2min)
    const bu = await searchLinkedIn(c.full_name, c.employer_name!);

    const agreement = {
      nameMatch: fuzzyMatch(pdl.fullName, bu.name),
      titleMatch: fuzzyMatch(pdl.title, bu.currentTitle),
      companyMatch: fuzzyMatch(pdl.company, bu.currentCompany),
    };

    const validation = {
      pdlTitleMatchesKnown: c.title ? fuzzyMatch(pdl.title, c.title) : null,
      buTitleMatchesKnown: c.title ? fuzzyMatch(bu.currentTitle, c.title) : null,
      pdlLinkedinMatchesKnown: c.linkedin_url ? linkedinSlugMatch(pdl.linkedinUrl, c.linkedin_url) : null,
      buLinkedinMatchesKnown: c.linkedin_url ? linkedinSlugMatch(bu.profileUrl, c.linkedin_url) : null,
    };

    results.push({
      contact: { name: c.full_name, title: c.title, employer: c.employer_name, domain: c.company_domain, knownLinkedin: c.linkedin_url },
      pdl,
      browserUse: bu,
      agreement,
      validation,
    });

    const pdlIcon = pdl.found ? 'Y' : 'N';
    const buIcon = bu.found ? 'Y' : 'N';
    console.log(`  PDL ${pdlIcon}: ${pdl.fullName || '--'} | ${pdl.title || '--'} @ ${pdl.company || '--'} | lkl:${pdl.likelihood ?? '--'}${pdl.error ? ` | ERR: ${pdl.error}` : ''}`);
    console.log(`  BU  ${buIcon}: ${bu.name || '--'} | ${bu.currentTitle || '--'} @ ${bu.currentCompany || '--'} | ${bu.durationMs ? (bu.durationMs / 1000).toFixed(0) + 's' : ''}${bu.reason ? ` | ${bu.reason}` : ''}${bu.error ? ` | ERR: ${bu.error}` : ''}`);
    if (bu.profileUrl) console.log(`  BU profile URL: ${bu.profileUrl}`);

    const agreeStr = `name=${fmtBool(agreement.nameMatch)} title=${fmtBool(agreement.titleMatch)} company=${fmtBool(agreement.companyMatch)}`;
    const valStr = `pdl_li=${fmtBool(validation.pdlLinkedinMatchesKnown)} bu_li=${fmtBool(validation.buLinkedinMatchesKnown)}`;
    console.log(`  Agree: ${agreeStr} | Validation: ${valStr}`);
  }

  // ── Summary Report ─────────────────────────────────────────────────────

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log('\n' + '='.repeat(110));
  console.log(`SUMMARY REPORT (${totalTime} minutes)`);
  console.log('='.repeat(110));

  const n = results.length;
  const pdlFound = results.filter(r => r.pdl.found).length;
  const buFound = results.filter(r => r.browserUse.found).length;
  const bothFound = results.filter(r => r.pdl.found && r.browserUse.found).length;
  const pdlOnly = results.filter(r => r.pdl.found && !r.browserUse.found).length;
  const buOnly = results.filter(r => !r.pdl.found && r.browserUse.found).length;
  const neitherFound = results.filter(r => !r.pdl.found && !r.browserUse.found).length;
  const eitherFound = pdlFound + buFound - bothFound;

  console.log(`\nHit Rate (n=${n}):`);
  console.log(`  PDL found:        ${pdlFound}/${n} (${pct(pdlFound, n)})`);
  console.log(`  BrowserUse found: ${buFound}/${n} (${pct(buFound, n)})`);
  console.log(`  Both found:       ${bothFound}/${n} (${pct(bothFound, n)})`);
  console.log(`  PDL only:         ${pdlOnly}/${n} (${pct(pdlOnly, n)})`);
  console.log(`  BU only:          ${buOnly}/${n} (${pct(buOnly, n)})`);
  console.log(`  Either found:     ${eitherFound}/${n} (${pct(eitherFound, n)})`);
  console.log(`  Neither:          ${neitherFound}/${n} (${pct(neitherFound, n)})`);

  const pdlErrors = results.filter(r => r.pdl.error).length;
  const buErrors = results.filter(r => r.browserUse.error).length;
  console.log(`  PDL errors: ${pdlErrors} | BU errors: ${buErrors}`);

  // PDL LinkedIn accuracy
  const pdlWithLinkedin = results.filter(r => r.pdl.linkedinUrl).length;
  const pdlLinkedinCorrect = results.filter(r => r.validation.pdlLinkedinMatchesKnown === true).length;
  console.log(`\nPDL LinkedIn Discovery:`);
  console.log(`  Returned a LinkedIn URL: ${pdlWithLinkedin}/${n} (${pct(pdlWithLinkedin, n)})`);
  console.log(`  Correct (matches known): ${pdlLinkedinCorrect}/${pdlWithLinkedin} (${pct(pdlLinkedinCorrect, pdlWithLinkedin)})`);

  // BU LinkedIn accuracy
  const buWithLinkedin = results.filter(r => r.browserUse.profileUrl).length;
  const buLinkedinCorrect = results.filter(r => r.validation.buLinkedinMatchesKnown === true).length;
  console.log(`\nBrowserUse LinkedIn Discovery:`);
  console.log(`  Found a profile:         ${buWithLinkedin}/${n} (${pct(buWithLinkedin, n)})`);
  console.log(`  Correct (matches known): ${buLinkedinCorrect}/${buWithLinkedin} (${pct(buLinkedinCorrect, buWithLinkedin)})`);

  // Agreement stats
  const comparable = results.filter(r => r.pdl.found && r.browserUse.found);
  if (comparable.length > 0) {
    const nameAgree = comparable.filter(r => r.agreement.nameMatch === true).length;
    const titleBothPresent = comparable.filter(r => r.pdl.title && r.browserUse.currentTitle).length;
    const titleAgree = comparable.filter(r => r.agreement.titleMatch === true).length;
    const companyBothPresent = comparable.filter(r => r.pdl.company && r.browserUse.currentCompany).length;
    const companyAgree = comparable.filter(r => r.agreement.companyMatch === true).length;

    console.log(`\nPDL vs BrowserUse Agreement (both found, n=${comparable.length}):`);
    console.log(`  Name:    ${nameAgree}/${comparable.length} (${pct(nameAgree, comparable.length)})`);
    console.log(`  Title:   ${titleAgree}/${titleBothPresent} with data (${pct(titleAgree, titleBothPresent)})`);
    console.log(`  Company: ${companyAgree}/${companyBothPresent} with data (${pct(companyAgree, companyBothPresent)})`);
  }

  // Validation: title accuracy
  const withKnownTitle = results.filter(r => r.contact.title);
  if (withKnownTitle.length > 0) {
    const pdlTitleCorrect = withKnownTitle.filter(r => r.validation.pdlTitleMatchesKnown === true).length;
    const buTitleCorrect = withKnownTitle.filter(r => r.validation.buTitleMatchesKnown === true).length;
    const pdlTitleReturned = withKnownTitle.filter(r => r.pdl.title).length;
    const buTitleReturned = withKnownTitle.filter(r => r.browserUse.currentTitle).length;

    console.log(`\nTitle Accuracy vs Known (n=${withKnownTitle.length} with known title):`);
    console.log(`  PDL:  ${pdlTitleCorrect}/${pdlTitleReturned} returned match known (${pct(pdlTitleCorrect, pdlTitleReturned)})`);
    console.log(`  BU:   ${buTitleCorrect}/${buTitleReturned} returned match known (${pct(buTitleCorrect, buTitleReturned)})`);
  }

  // Data richness
  console.log(`\nPDL Data Richness (when found, n=${pdlFound}):`);
  const withEmail = results.filter(r => r.pdl.found && r.pdl.workEmail).length;
  const withPhone = results.filter(r => r.pdl.found && r.pdl.mobilePhone).length;
  const withLoc = results.filter(r => r.pdl.found && r.pdl.location).length;
  console.log(`  Work email:   ${withEmail}/${pdlFound}`);
  console.log(`  Mobile phone: ${withPhone}/${pdlFound}`);
  console.log(`  Location:     ${withLoc}/${pdlFound}`);

  console.log(`\nBrowserUse Data Richness (when found, n=${buFound}):`);
  const buWithExp = results.filter(r => r.browserUse.found && r.browserUse.experiences.length > 0).length;
  const buWithEdu = results.filter(r => r.browserUse.found && r.browserUse.education.length > 0).length;
  const buWithLoc = results.filter(r => r.browserUse.found && r.browserUse.location).length;
  const buWithHeadline = results.filter(r => r.browserUse.found && r.browserUse.headline).length;
  console.log(`  Experiences:  ${buWithExp}/${buFound}`);
  console.log(`  Education:    ${buWithEdu}/${buFound}`);
  console.log(`  Location:     ${buWithLoc}/${buFound}`);
  console.log(`  Headline:     ${buWithHeadline}/${buFound}`);

  // Disagreements
  const disagreements = comparable.filter(r =>
    r.agreement.titleMatch === false || r.agreement.companyMatch === false
  );
  if (disagreements.length > 0) {
    console.log(`\nDisagreements (${disagreements.length}):`);
    for (const d of disagreements) {
      const issues: string[] = [];
      if (d.agreement.titleMatch === false) issues.push(`title: PDL="${d.pdl.title}" vs BU="${d.browserUse.currentTitle}"`);
      if (d.agreement.companyMatch === false) issues.push(`company: PDL="${d.pdl.company}" vs BU="${d.browserUse.currentCompany}"`);
      console.log(`  ${d.contact.name}: ${issues.join(' | ')}`);
    }
  }

  // BU-only finds
  const buOnlyList = results.filter(r => !r.pdl.found && r.browserUse.found);
  if (buOnlyList.length > 0) {
    console.log(`\nBrowserUse found but PDL missed (${buOnlyList.length}):`);
    for (const d of buOnlyList) {
      console.log(`  ${d.contact.name}: BU="${d.browserUse.currentTitle} @ ${d.browserUse.currentCompany}"`);
    }
  }

  // PDL-only finds
  const pdlOnlyList = results.filter(r => r.pdl.found && !r.browserUse.found);
  if (pdlOnlyList.length > 0) {
    console.log(`\nPDL found but BrowserUse missed (${pdlOnlyList.length}):`);
    for (const d of pdlOnlyList) {
      console.log(`  ${d.contact.name}: PDL="${d.pdl.title} @ ${d.pdl.company}" lkl:${d.pdl.likelihood}`);
    }
  }

  // Write full results
  const outPath = '/Users/remy/Downloads/pdl-vs-browseruse-comparison-v2.json';
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to: ${outPath}`);
}

function fmtBool(v: boolean | null): string {
  if (v === null) return '--';
  return v ? 'Y' : 'N';
}

function pct(n: number, total: number): string {
  if (total === 0) return 'N/A';
  return `${(n / total * 100).toFixed(0)}%`;
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
