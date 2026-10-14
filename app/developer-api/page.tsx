import './dev-api.css';
import Link from 'next/link';
import InfoPage, { LegalDoc, type LegalSection } from '@/components/InfoPage';
import { EMAIL } from '@/lib/contact';
import { SITE_URL } from '@/lib/seo/config';
import { API_BASE_PATH, LIMITS, SCOPES, SCOPE_LIST } from '@/lib/api-platform/config';

// Public documentation for the Mappingg Developer API. Values (scopes, limits,
// base URL) come from lib/api-platform/config.ts — the same constants the
// server enforces — so the docs can't drift from the implementation.

const BASE = `${SITE_URL}${API_BASE_PATH}`;

const ENDPOINTS: [string, string, string][] = [
  ['GET /health', 'none', 'Service status: ok or degraded. No key needed.'],
  ['GET /openapi.json', 'none', 'This API as an OpenAPI 3.1 document.'],
  ['GET /sample/projects', 'none', 'Three sample projects, so you can see the shape before you have a key.'],
  ['GET /metadata', 'any key', 'Your application, its scopes and its limits.'],
  ['GET /projects', 'projects:read', 'Public projects, with filters and pagination.'],
  ['GET /projects/{id}', 'projects:read', 'One project by number (e.g. 135) or slug.'],
  ['GET /categories', 'projects:read', 'Statuses, property types and cities, with project counts.'],
  ['GET /developers', 'developers:read', 'Developers (builders) with public projects.'],
  ['GET /developers/{id}', 'developers:read', 'One developer and their projects.'],
  ['GET /localities', 'localities:read', 'Localities with public projects.'],
  ['GET /localities/{id}', 'localities:read', 'One locality and its projects.'],
  ['GET /map/pins', 'map:read', 'Project pins inside a bounding box, clustered below zoom 13.'],
  ['GET /map/infrastructure', 'infrastructure:read', 'Metro stations, hospitals, schools and other public map markers.'],
  ['GET /blogs', 'blogs:read', 'Published articles (no drafts), newest first.'],
  ['GET /blogs/{slug}', 'blogs:read', 'One published article, with its HTML.'],
];

const ERRORS: [string, string, string][] = [
  ['400', 'invalid_parameter', 'Unknown, repeated or out-of-range query parameter, or a malformed id.'],
  ['401', 'missing_api_key', 'No Authorization: Bearer header.'],
  ['401', 'invalid_api_key / revoked_api_key / expired_api_key', 'The key is wrong, was revoked, or has expired.'],
  ['403', 'insufficient_scope', 'The key is valid but not allowed to use this endpoint.'],
  ['403', 'application_disabled / application_revoked / application_expired', 'Your application has been paused, revoked or has expired.'],
  ['404', 'not_found', 'No such project, developer, locality, article or endpoint.'],
  ['429', 'rate_limited / quota_exceeded / client_blocked', 'Too many requests. Wait for the number of seconds in Retry-After.'],
  ['500 / 504', 'internal_error / timeout', 'Our side. Retry later and quote the requestId if it persists.'],
  ['503', 'api_disabled', 'The API is temporarily switched off.'],
];

const Code = ({ children }: { children: string }) => <pre className="dapi-code"><code>{children.trim()}</code></pre>;
const Row = ({ cells, labels }: { cells: React.ReactNode[]; labels: string[] }) => (
  <tr>{cells.map((c, i) => <td key={i} data-label={labels[i]}>{c}</td>)}</tr>
);

const sections: LegalSection[] = [
  {
    id: 'overview',
    title: 'What the API provides',
    body: (
      <>
        <p>
          The Mappingg Developer API gives approved partners read-only access to the same public data shown on mappingg.com:
          projects (name, developer, locality, configuration, published price, possession, MahaRERA number where listed,
          coordinates and image), developers, localities, map pins, infrastructure markers and published articles.
        </p>
        <p>
          It does <b>not</b> give access to buyer or customer details, enquiries and leads, accounts, drafts or unpublished
          content, uploaded files, the admin panel, or the database. If a project field is hidden on the project’s public
          card, it is <code>null</code> in the API too. Hidden, pending-review and rejected projects are never returned.
        </p>
      </>
    ),
  },
  {
    id: 'access',
    title: 'Getting access',
    body: (
      <>
        <ol style={{ paddingLeft: 20, margin: '0 0 14px' }}>
          <li>Email <a href={`mailto:${EMAIL}?subject=Developer%20API%20access`}>{EMAIL}</a> with your organisation, website, contact person and what you want to build.</li>
          <li>We review the request and create an application for you with only the scopes you need, and agreed limits.</li>
          <li>You receive your API key once, privately. Store it in your server’s secret store or environment variables.</li>
        </ol>
        <p>Keys can be rotated (with an overlap period so you can switch without downtime) or revoked at any time.</p>
      </>
    ),
  },
  {
    id: 'authentication',
    title: 'Authentication',
    body: (
      <>
        <p>Send your key in the <code>Authorization</code> header on every request:</p>
        <Code>{'Authorization: Bearer mgk_xxxxxxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}</Code>
        <div className="dapi-warn"><i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>Call the API from your <b>server</b> only. Never put the key in browser JavaScript, a mobile app, a public
          repository or a URL. Keys in query strings are not accepted. If a key leaks, tell us and we will revoke it at once.</span>
        </div>
        <p>
          Keyed endpoints send no CORS headers, so browsers can’t call them directly. For a public web page, fetch from your own
          backend and cache the result there. The three endpoints that need no key (<code>/health</code>,
          <code>/openapi.json</code>, <code>/sample/projects</code>) allow any origin.
        </p>
      </>
    ),
  },
  {
    id: 'endpoints',
    title: 'Base URL and endpoints',
    body: (
      <>
        <p>Base URL: <code>{BASE}</code>. All endpoints are <code>GET</code> and return JSON.</p>
        <div className="ipg-table dapi-table">
          <table>
            <thead><tr><th>Endpoint</th><th>Scope</th><th>Returns</th></tr></thead>
            <tbody>{ENDPOINTS.map(([e, s, d]) => <Row key={e} labels={['Endpoint', 'Scope', 'Returns']} cells={[<code key="e">{e}</code>, s === 'none' || s === 'any key' ? s : <code key="s">{s}</code>, d]} />)}</tbody>
          </table>
        </div>
        <p>Full parameters and response schemas: <Link href="/developer-api/reference">API reference</Link> · <a href={`${API_BASE_PATH}/openapi.json`}>openapi.json</a>.</p>
      </>
    ),
  },
  {
    id: 'scopes',
    title: 'Scopes',
    body: (
      <>
        <p>Each application is given only the scopes it needs. All scopes are read-only.</p>
        <div className="ipg-table dapi-table">
          <table>
            <thead><tr><th>Scope</th><th>Allows</th></tr></thead>
            <tbody>{SCOPE_LIST.map((s) => <Row key={s} labels={['Scope', 'Allows']} cells={[<code key="s">{s}</code>, SCOPES[s]]} />)}</tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: 'parameters',
    title: 'Filtering and pagination',
    body: (
      <>
        <p>
          List endpoints take <code>page</code> (from 1) and <code>limit</code>. The default page size is 20, and the maximum is
          your application’s page size (at most {LIMITS.maxPageSize}). Paging stops at record {LIMITS.maxOffset.toLocaleString('en-IN')}:
          narrow your filters to go further. Unknown or repeated parameters return <code>400</code>, so typos don’t silently
          return everything.
        </p>
        <p><code>/projects</code> filters: <code>q</code> (name search), <code>locality</code>, <code>developer</code>, <code>type</code> (ids from the
          other endpoints), <code>city</code> (<code>pune</code>, <code>mumbai</code>, …), <code>status</code> (<code>upcoming</code>,
          <code>under_construction</code>, <code>ready_to_move</code>, <code>sold</code>), <code>updated_since</code> (ISO 8601) and
          <code>sort</code> (<code>id</code>, <code>name</code>, <code>-updated_at</code>).</p>
        <p><code>/map/pins</code> needs <code>north</code>, <code>south</code>, <code>east</code> and <code>west</code>. Add <code>zoom</code> to get clusters
          below zoom 13, and <code>limit</code> (up to 500 pins).</p>
        <span className="dapi-label">Response</span>
        <Code>{`
{
  "success": true,
  "data": [
    {
      "id": 135,
      "slug": "example-project-kharadi-135",
      "url": "${SITE_URL}/projects/example-project-kharadi-135",
      "name": "Example Project",
      "developer": { "id": "example-developers", "name": "Example Developers" },
      "property_type": "Residential",
      "status": "under_construction",
      "status_label": "Under construction",
      "configuration": "2 / 3 / 4 BHK",
      "price": "₹ 1.12 Cr Onwards",
      "possession": "Dec 2030",
      "locality": { "id": "kharadi", "name": "Kharadi" },
      "city": { "id": "pune", "name": "Pune" },
      "coordinates": { "lat": 18.55, "lng": 73.94 },
      "image_url": "${SITE_URL}/api/media/pins/…",
      "updated_at": "2026-10-01T10:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "hasMore": false },
  "meta": { "requestId": "6f1c…", "apiVersion": "v1" }
}`}</Code>
        <p><small>Illustrative values. Prices, configurations and possession dates are the text published on the project page; they are not normalised. Try <a href={`${API_BASE_PATH}/sample/projects`}>/sample/projects</a> for live examples.</small></p>
      </>
    ),
  },
  {
    id: 'errors',
    title: 'Errors',
    body: (
      <>
        <p>Errors use one shape. Quote the <code>requestId</code> (also in the <code>X-Request-Id</code> header) when you contact support.</p>
        <Code>{`
{
  "success": false,
  "error": { "code": "insufficient_scope", "message": "This key is not allowed to use this endpoint (needs scope \\"blogs:read\\").", "requestId": "6f1c…" }
}`}</Code>
        <div className="ipg-table dapi-table">
          <table>
            <thead><tr><th>Status</th><th>Code</th><th>Meaning</th></tr></thead>
            <tbody>{ERRORS.map(([s, c, d]) => <Row key={c} labels={['Status', 'Code', 'Meaning']} cells={[s, <code key="c">{c}</code>, d]} />)}</tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: 'limits',
    title: 'Rate limits and quotas',
    body: (
      <>
        <p>
          Each application has a per-minute limit (default {LIMITS.defaultRatePerMinute}), a daily quota (default {LIMITS.defaultDailyQuota.toLocaleString('en-IN')} requests,
          resetting at 00:00 UTC) and at most {LIMITS.maxConcurrentPerApp} requests in flight. Every keyed response carries:
        </p>
        <Code>{`
X-RateLimit-Limit: 60          X-Quota-Limit: 5000
X-RateLimit-Remaining: 57      X-Quota-Remaining: 4812
X-RateLimit-Reset: 1791712860  X-Quota-Reset: 1791763200   (Unix seconds)`}</Code>
        <p>
          Over a limit you get <code>429</code> with <code>Retry-After</code> (seconds). Back off and retry after it. Clients that keep
          failing authentication are blocked for {LIMITS.authFailureWindowSec / 60} minutes. Unauthenticated endpoints allow {LIMITS.publicPerMinute} requests a
          minute per client. Need more? Ask us — limits are set per application.
        </p>
      </>
    ),
  },
  {
    id: 'caching',
    title: 'Caching and freshness',
    body: (
      <p>
        Data is read from the live site with a short server cache, so changes appear within about a minute. Keyed responses
        are <code>Cache-Control: private, max-age=30</code> with <code>Vary: Authorization</code>: you may cache them in your own
        backend, but they must not be stored in a shared/public cache. For syncing, poll <code>/projects?updated_since=…&amp;sort=-updated_at</code>
        instead of downloading everything. Projects that are unpublished disappear from responses (404 for a single project),
        so re-check stored projects periodically and drop the ones that are gone.
      </p>
    ),
  },
  {
    id: 'examples',
    title: 'Code examples',
    body: (
      <>
        <p>Read the key from an environment variable (here <code>MAPPINGG_API_KEY</code>). Never hard-code it.</p>
        <span className="dapi-label">cURL</span>
        <Code>{`
curl -s "${BASE}/projects?locality=kharadi&status=under_construction&limit=10" \\
  -H "Authorization: Bearer $MAPPINGG_API_KEY"`}</Code>
        <span className="dapi-label">Node.js (18+)</span>
        <Code>{`
const res = await fetch('${BASE}/projects?city=pune&limit=20', {
  headers: { Authorization: \`Bearer \${process.env.MAPPINGG_API_KEY}\` },
});
if (res.status === 429) {
  const wait = Number(res.headers.get('retry-after') || 60);
  // back off for \`wait\` seconds, then retry
}
const body = await res.json();
if (!body.success) throw new Error(\`\${body.error.code}: \${body.error.message} (\${body.error.requestId})\`);
for (const p of body.data) console.log(p.id, p.name, p.price, p.url);`}</Code>
        <span className="dapi-label">Python (requests)</span>
        <Code>{`
import os, requests

r = requests.get(
    "${BASE}/projects",
    params={"locality": "kharadi", "page": 1, "limit": 20},
    headers={"Authorization": f"Bearer {os.environ['MAPPINGG_API_KEY']}"},
    timeout=15,
)
body = r.json()
if not body["success"]:
    raise RuntimeError(f"{body['error']['code']}: {body['error']['message']}")
for p in body["data"]:
    print(p["id"], p["name"], p["price"], p["url"])`}</Code>
        <span className="dapi-label">PHP (cURL)</span>
        <Code>{`
<?php
$ch = curl_init('${BASE}/blogs?limit=5');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('MAPPINGG_API_KEY')],
]);
$body = json_decode(curl_exec($ch), true);
curl_close($ch);
if (!$body['success']) { throw new Exception($body['error']['code']); }
foreach ($body['data'] as $post) { echo $post['title'], ' — ', $post['url'], PHP_EOL; }`}</Code>
        <span className="dapi-label">Map pins in a viewport</span>
        <Code>{`
curl -s "${BASE}/map/pins?north=18.60&south=18.50&east=73.98&west=73.88&zoom=14" \\
  -H "Authorization: Bearer $MAPPINGG_API_KEY"`}</Code>
        <p>No key yet? Try <a href={`${API_BASE_PATH}/sample/projects`}>{API_BASE_PATH}/sample/projects</a> and <a href={`${API_BASE_PATH}/health`}>{API_BASE_PATH}/health</a> in your browser.</p>
      </>
    ),
  },
  {
    id: 'usage',
    title: 'Attribution and permitted use',
    body: (
      <>
        <p>
          Wherever you show Mappingg data, show “Source: Mappingg” with a link to the project or page <code>url</code> from the
          response. Use the data to inform buyers and power your own product; don’t resell it as a dataset, try to rebuild the
          whole database by scraping, or present it as your own verified data.
        </p>
        <p>
          Project details come from developers and are shown for reference only (see our <Link href="/disclaimer">disclaimer</Link>).
          MahaRERA numbers are as listed — verify them on the MahaRERA website before relying on them. Use of the API is also
          covered by our <Link href="/terms">terms of use</Link> and <Link href="/privacy">privacy policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'versioning',
    title: 'Versioning and changes',
    body: (
      <p>
        The version is in the path (<code>/api/v1</code>). Within v1 we only make additive changes: new endpoints, new optional
        parameters and new response fields — ignore fields you don’t know. Breaking changes go into a new version, and v1 keeps
        working for at least 6 months after the new version is announced to every registered contact email.
      </p>
    ),
  },
  {
    id: 'security',
    title: 'Security guidance',
    body: (
      <ul>
        <li>Keep keys server-side, in a secret manager or environment variables; never commit them.</li>
        <li>Use one application (and key) per integration, so one can be revoked without affecting the others.</li>
        <li>Rotate keys if a team member with access leaves; rotation keeps the old key working for an overlap period you choose.</li>
        <li>Article <code>content_html</code> is our published HTML: sanitise it before inserting it into your own pages.</li>
        <li>Report a suspected leak or vulnerability to <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</li>
      </ul>
    ),
  },
  {
    id: 'support',
    title: 'Support',
    body: (
      <p>
        Email <a href={`mailto:${EMAIL}?subject=Developer%20API%20support`}>{EMAIL}</a> with your application id and the
        <code>requestId</code> of the failing request. Service status: <a href={`${API_BASE_PATH}/health`}>{API_BASE_PATH}/health</a>.
      </p>
    ),
  },
];

export default function DeveloperApiPage() {
  return (
    <InfoPage
      path="/developer-api"
      crumb="Developer API"
      eyebrow="For developers & partners"
      icon="fas fa-plug"
      tone="water"
      title={<>Mappingg <span className="accent">Developer API</span></>}
      intro="Read-only access to Mappingg’s public project, developer, locality, map and article data for approved partners."
      actions={
        <>
          <Link className="btn btn-primary" href="/developer-api/reference"><i className="fas fa-book" aria-hidden="true" /> API reference</Link>
          <a className="btn btn-outline" href={`mailto:${EMAIL}?subject=Developer%20API%20access`}><i className="fas fa-key" aria-hidden="true" /> Request access</a>
        </>
      }
    >
      <LegalDoc
        path="/developer-api"
        intro={<>Base URL <code>{BASE}</code> · JSON over HTTPS · <code>Authorization: Bearer &lt;key&gt;</code> · read-only.</>}
        sections={sections}
      />
    </InfoPage>
  );
}
