import assert from 'node:assert/strict';

// Fixed metadata for the identities used by these handler-flow tests. These are
// fixtures, not live bibliographic verification or model-generated candidates.
const fixtures = new Map([
  ['2301.04104', { title: 'Mastering Diverse Domains through World Models', year: 2023, author: 'Danijar Hafner' }],
  ['1803.10122', { title: 'World Models', year: 2018, author: 'David Ha' }],
]);

/** Isolate legacy handler tests from every real network service. */
export function installLegacyMetadata(expectedIds) {
  const previousFetch = globalThis.fetch;
  const unexpected = [];
  const observed = new Set();
  globalThis.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = options?.method ?? (input instanceof Request ? input.method : 'GET');
    const provider = url.origin === 'https://api.crossref.org' && url.pathname.startsWith('/works/') ? 'crossref'
      : url.origin === 'https://api.openalex.org' && url.pathname === '/works' ? 'openalex' : undefined;
    const doi = provider === 'crossref' ? decodeURIComponent(url.pathname.slice('/works/'.length))
      : provider === 'openalex' ? url.searchParams.get('filter')?.replace(/^doi:/, '') : undefined;
    const id = doi?.match(/^10\.48550\/arxiv\.(2301\.04104|1803\.10122)$/i)?.[1];
    const fixture = id && expectedIds.includes(id) ? fixtures.get(id) : undefined;
    if (method === 'GET' && provider && fixture) {
      observed.add(provider + ':' + id);
      if (provider === 'crossref') {
        return Response.json({ message: {
          DOI: doi, title: [fixture.title], author: [{ family: fixture.author }],
          published: { 'date-parts': [[fixture.year]] }, 'container-title': ['arXiv'],
        } });
      }
      return Response.json({ results: [{
        display_name: fixture.title, publication_year: fixture.year,
        authorships: [{ author: { display_name: fixture.author } }],
        primary_location: { source: { display_name: 'arXiv' } },
        abstract_inverted_index: { Fixture: [0], abstract: [1], for: [2], 'world-model': [3], research: [4] },
        cited_by_count: 0, ids: { doi: 'https://doi.org/' + doi, arxiv: 'https://arxiv.org/abs/' + id },
      }] });
    }
    unexpected.push(url.href);
    throw new Error('Unexpected network request in isolated legacy test: ' + url.href);
  };
  return {
    assertComplete() {
      globalThis.fetch = previousFetch;
      assert.deepEqual(unexpected, [], 'legacy tests must not make unmocked network requests');
      for (const id of expectedIds) {
        for (const provider of ['crossref', 'openalex']) {
          assert.ok(observed.has(provider + ':' + id), 'metadata fixture must be exercised: ' + provider + ':' + id);
        }
      }
    },
  };
}
