import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveImportQuery, automaticImportCandidate } from '../src/lib/paper-import-search.ts';
import { searchPapers } from '../src/lib/paper-tools.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const work = (extra = {}) => ({
  id: 'https://openalex.org/W1', display_name: 'Attention Is All You Need',
  doi: 'https://doi.org/10.1234/attention', publication_year: 2017,
  authorships: [{ author: { display_name: 'A. Author' } }],
  open_access: { is_oa: true, oa_url: 'https://publisher.example/landing' },
  primary_location: { landing_page_url: 'https://publisher.example/article' }, ...extra,
});
const hit = (extra = {}) => ({ id: 'one', title: 'Attention Is All You Need', authors: '', year: '2017', abstract: '', isOa: true, publisherUrl: '', publisherName: '', ...extra });
const atom = (id = '1706.03762v7') => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>http://arxiv.org/abs/${id}</id><title>Attention Is\n All You Need</title>
  <summary>A &amp; B &#x3b1;.</summary><published>2017-06-12T00:00:00Z</published>
  <author><name>A &amp; B</name></author><author><name>C Author</name></author>
  <link title="pdf" href="http://arxiv.org/pdf/${id}" rel="related" type="application/pdf"/>
</entry></feed>`;

test('only unique normalized whole titles are automatically selected', () => {
  assert.equal(automaticImportCandidate('attention—is all you need!', [hit()]), 'one');
  assert.equal(automaticImportCandidate('attention', [hit()]), undefined);
  assert.equal(automaticImportCandidate('Attention Is All You Need', [hit(), hit({id:'two'})]), undefined);
  assert.equal(automaticImportCandidate('...', [hit({title:'...'})]), undefined);
});

test('identifier matching accepts DOI URLs and arxiv versions without guessing a version', () => {
  assert.equal(automaticImportCandidate('https://doi.org/10.1234/ABC', [hit({doi:'10.1234/abc'})]), 'one');
  assert.equal(automaticImportCandidate('arXiv:1706.03762', [hit({arxivId:'1706.03762v7'})]), 'one');
  assert.equal(automaticImportCandidate('https://arxiv.org/pdf/1706.03762v7.pdf', [hit({arxivId:'1706.03762v7'})]), 'one');
  assert.equal(automaticImportCandidate('1706.03762v6', [hit({arxivId:'1706.03762v7'})]), undefined);
  assert.equal(automaticImportCandidate('10.1234/abc', [hit({doi:'10.1234/abc'}),hit({id:'two',doi:'10.1234/abc'})]), undefined);
});

test('OpenAlex chooses the best PDF location instead of an OA landing page', async () => {
  globalThis.fetch = async (url, options) => {
    const request = new URL(url);
    assert.equal(request.hostname, 'api.openalex.org');
    assert.ok(request.searchParams.get('select').includes('best_oa_location'));
    assert.notEqual(request.searchParams.get('mailto'), 'research@atelier.local');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({results:[work({best_oa_location:{pdf_url:'https://repo.example/paper.pdf'},primary_location:{pdf_url:'https://publisher.example/paper.pdf'}})]});
  };
  const [paper] = await resolveImportQuery('Attention Is All You Need');
  assert.equal(paper.oaPdfUrl, 'https://repo.example/paper.pdf');
  assert.equal(paper.authors, 'A. Author');
});

test('OpenAlex uses primary or an OA location PDF and never invents a PDF from a landing page', async () => {
  globalThis.fetch = async () => Response.json({results:[
    work({id:'primary',primary_location:{pdf_url:'https://publisher.example/paper.pdf'}}),
    work({id:'location',locations:[{is_oa:false,pdf_url:'https://closed.example/paper.pdf'},{is_oa:true,pdf_url:'https://repo.example/paper.pdf'}]}),
    work({id:'landing'}),
  ]});
  const papers = await searchPapers('Attention');
  assert.deepEqual(papers.map(p=>p.oaPdfUrl), ['https://publisher.example/paper.pdf','https://repo.example/paper.pdf',undefined]);
});

test('DOI queries use exact OpenAlex lookup', async () => {
  globalThis.fetch = async url => {
    const request = new URL(url);
    assert.equal(decodeURIComponent(request.pathname), '/works/https://doi.org/10.1234/attention');
    assert.equal(request.searchParams.has('search'),false);
    return Response.json(work());
  };
  const hits = await resolveImportQuery('doi:10.1234/attention');
  assert.equal(hits.length,1);
  assert.equal(automaticImportCandidate('10.1234/attention',hits),'https://openalex.org/W1');
});

test('arxiv identifier lookup parses returned metadata and the real PDF link', async () => {
  globalThis.fetch = async (url,options) => {
    const request = new URL(url);
    assert.equal(request.hostname,'export.arxiv.org');
    assert.equal(request.searchParams.get('id_list'),'1706.03762v7');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(atom());
  };
  const [paper] = await resolveImportQuery('https://arxiv.org/abs/1706.03762v7');
  assert.equal(paper.arxivId,'1706.03762v7');
  assert.equal(paper.title,'Attention Is All You Need');
  assert.equal(paper.authors,'A & B, C Author');
  assert.equal(paper.abstract,'A & B α.');
  assert.equal(paper.oaPdfUrl,'http://arxiv.org/pdf/1706.03762v7');
});

test('legacy arxiv identifiers preserve their subject prefix', async () => {
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('id_list'),'hep-th/9901001');
    return new Response(atom('hep-th/9901001'));
  };
  assert.equal((await resolveImportQuery('arxiv:hep-th/9901001'))[0].arxivId,'hep-th/9901001');
});

test('empty OpenAlex results fall back to a genuine arxiv title search', async () => {
  globalThis.fetch = async url => {
    const request = new URL(url);
    if(request.hostname==='api.openalex.org') return Response.json({results:[]});
    assert.match(request.searchParams.get('search_query'), /^ti:/);
    return new Response(atom());
  };
  assert.equal((await resolveImportQuery('Attention Is All You Need'))[0].arxivId,'1706.03762v7');
});

test('arxiv empty results stay empty; malformed responses fail explicitly', async () => {
  globalThis.fetch = async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  assert.deepEqual(await resolveImportQuery('1706.03762'),[]);
  globalThis.fetch = async () => new Response('<html>Bad gateway</html>');
  await assert.rejects(resolveImportQuery('1706.03762'),/arxiv|arXiv|响应/);
});

test('malformed OpenAlex records do not become import candidates', async () => {
  globalThis.fetch = async url => new URL(url).hostname==='api.openalex.org'
    ? Response.json({results:[null,{display_name:'missing identity'},{id:'missing title'},work({id:'good',authorships:{bad:true},abstract_inverted_index:{word:null}})]})
    : new Response('<feed></feed>');
  const hits = await resolveImportQuery('Attention Is All You Need');
  assert.equal(hits.length,1);
  assert.equal(hits[0].id,'good');
});

test('empty and oversized queries reject before making network requests', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('<feed></feed>'); };
  await assert.rejects(resolveImportQuery('   '));
  await assert.rejects(resolveImportQuery('a'.repeat(501)));
  await assert.rejects(resolveImportQuery('1. ** **'));
  await assert.rejects(resolveImportQuery('...'));
  assert.equal(requests, 0);
});

test('a missing DOI returns no candidates without a broad title search', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(new URL(url).hostname,'api.openalex.org');
    return new Response('',{status:404});
  };
  assert.deepEqual(await resolveImportQuery('10.1234/missing'),[]);
  assert.equal(calls,1);
});

test('OpenAlex rejection or malformed payload can fall back to arxiv', async () => {
  for (const response of [new Response('',{status:401}),Response.json({results:'invalid'})]) {
    globalThis.fetch = async url => new URL(url).hostname==='api.openalex.org' ? response : new Response(atom());
    assert.equal((await resolveImportQuery('Attention Is All You Need'))[0].arxivId,'1706.03762v7');
  }
});

test('failure of both metadata services is surfaced instead of fabricating candidates', async () => {
  globalThis.fetch = async () => new Response('',{status:403});
  await assert.rejects(resolveImportQuery('Attention Is All You Need'),/OpenAlex.*arXiv/);
});

test('arxiv lookup does not accept a different returned identifier or explicit version', async () => {
  globalThis.fetch = async () => new Response(atom('1706.03762v7'));
  assert.deepEqual(await resolveImportQuery('1706.03762v6'),[]);
  assert.deepEqual(await resolveImportQuery('2401.12345'),[]);
});

test('mixed numbered notes search the paper name instead of the accompanying Chinese description', async () => {
  const queries = [];
  globalThis.fetch = async url => {
    const request = new URL(url);
    queries.push(request.searchParams.get('search') || request.searchParams.get('search_query'));
    return request.hostname === 'api.openalex.org' ? Response.json({ results: [] })
      : new Response(atom().replace('Attention Is\n All You Need', 'DroneFINE: Learning Fine-Grained Navigation'));
  };
  const papers = await resolveImportQuery('2. **DroneFINE**：低空视觉语言导航，使用细粒度指令');
  assert.equal(queries[0], 'DroneFINE');
  assert.ok(queries.every(query => !/[\u4e00-\u9fff]/.test(query)));
  assert.equal(automaticImportCandidate('DroneFINE', papers), papers[0].id);
});

test('a unique named title prefix is selectable but mentions, longer words and ambiguous prefixes are not', () => {
  assert.equal(automaticImportCandidate('DroneFINE', [hit({ title: 'DroneFINE: Fine-Grained Navigation' })]), 'one');
  assert.equal(automaticImportCandidate('DroneFINE：无人机导航', [hit({ title: 'DroneFINE: Fine-Grained Navigation' })]), 'one');
  assert.equal(automaticImportCandidate('BERT', [hit({ title: 'Learning with BERT' })]), undefined);
  assert.equal(automaticImportCandidate('Drone', [hit({ title: 'DroneFINE: Fine-Grained Navigation' })]), undefined);
  assert.equal(automaticImportCandidate('DroneFINE', [hit({ title: 'DroneFINE: Navigation' }), hit({ id:'two', title:'DroneFINE: Tracking' })]), undefined);
});

test('matching OpenAlex metadata without a PDF is enriched from arxiv and deduplicated', async () => {
  let arxivCalls = 0;
  globalThis.fetch = async url => {
    if (new URL(url).hostname === 'api.openalex.org') return Response.json({ results:[work()] });
    arxivCalls++;
    return new Response(atom().replace('</entry>','<arxiv:doi>10.1234/attention</arxiv:doi></entry>'));
  };
  const papers = await resolveImportQuery('Attention Is All You Need');
  assert.equal(arxivCalls, 1);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].doi, '10.1234/attention');
  assert.equal(papers[0].arxivId, '1706.03762v7');
  assert.equal(papers[0].oaPdfUrl, 'http://arxiv.org/pdf/1706.03762v7');
});

test('irrelevant OpenAlex citation matches cannot suppress the named arxiv target', async () => {
  globalThis.fetch = async url => new URL(url).hostname === 'api.openalex.org'
    ? Response.json({ results: [work({display_name:'A survey of aircraft', best_oa_location:{pdf_url:'https://repo.example/survey.pdf'}})] })
    : new Response(atom().replace('Attention Is\n All You Need', 'DroneFINE: Fine-Grained Navigation'));
  const papers = await resolveImportQuery('DroneFINE');
  assert.equal(papers.length, 1);
  assert.match(papers[0].title, /^DroneFINE:/);
});

test('renamed projects can find their preprint through the descriptive subtitle from metadata', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    const request = new URL(url);
    if(request.hostname === 'api.openalex.org') return Response.json({results:[work({display_name:'NewName: A Vision Model for Flight', authorships:[{author:{display_name:'A & B'}}]})]});
    const query = request.searchParams.get('search_query');
    calls.push(query);
    return new Response(query.includes('A Vision Model for Flight')
      ? atom().replace('Attention Is\n All You Need', 'OldName: A Vision Model for Flight') : '<feed></feed>');
  };
  const papers = await resolveImportQuery('NewName');
  assert.equal(calls.length, 2);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, 'NewName: A Vision Model for Flight');
  assert.equal(papers[0].arxivId, '1706.03762v7');
});

test('arxiv can resolve an introduced project name appearing late in an abstract', async () => {
  globalThis.fetch = async url => {
    const request = new URL(url);
    if (request.hostname === 'api.openalex.org') return Response.json({results:[]});
    assert.match(request.searchParams.get('search_query'), /abs:/);
    return new Response(atom().replace('A &amp; B &#x3b1;.', `${'Context. '.repeat(90)}We introduce FlightExample for aerial navigation.`));
  };
  const hits = await resolveImportQuery('FlightExample');
  assert.equal(hits.length, 1);
  assert.match(hits[0].abstract, /FlightExample/);
  assert.equal(automaticImportCandidate('FlightExample', hits), undefined);
});

test('a shared arxiv identity merges different publication titles and preserves a real PDF', async () => {
  globalThis.fetch = async url => new URL(url).hostname === 'api.openalex.org'
    ? Response.json({results:[work({display_name:'FlightExample: Published Flight Model', primary_location:{landing_page_url:'https://arxiv.org/abs/1706.03762'}})]})
    : new Response(atom().replace('Attention Is\n All You Need','FlightExample: Preprint Flight Model'));
  const hits = await resolveImportQuery('FlightExample');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].oaPdfUrl);
  assert.equal(hits[0].title,'FlightExample: Published Flight Model');
});

test('one downloadable namesake does not stop PDF discovery for another matching work', async () => {
  globalThis.fetch = async url => new URL(url).hostname === 'api.openalex.org'
    ? Response.json({results:[
      work({id:'older',doi:'10.1234/old',display_name:'FlightExample: An Earlier Flight Model',best_oa_location:{pdf_url:'https://repo.example/old.pdf'}}),
      work({id:'newer',display_name:'FlightExample: A New Flight Model'}),
    ]})
    : new Response(atom().replace('Attention Is\n All You Need','FlightExample: A New Flight Model').replace('</entry>','<arxiv:doi>10.1234/attention</arxiv:doi></entry>'));
  const hits = await resolveImportQuery('FlightExample');
  assert.equal(hits.length,2);
  assert.ok(hits.find(hit=>hit.id==='newer').oaPdfUrl);
  assert.equal(automaticImportCandidate('FlightExample',hits),undefined);
});

test('identical titles from distinct authors remain ambiguous rather than merging', async () => {
  globalThis.fetch = async url => new URL(url).hostname === 'api.openalex.org'
    ? Response.json({results:[work({doi:undefined})]}) : new Response(atom());
  const hits = await resolveImportQuery('Attention Is All You Need');
  assert.equal(hits.length,2);
  assert.equal(automaticImportCandidate('Attention Is All You Need',hits),undefined);
});

test('matching title and author cannot merge contradictory identifiers or publication years', async () => {
  for (const conflicting of [
    {doi:'10.1234/other'},
    {doi:undefined,primary_location:{landing_page_url:'https://arxiv.org/abs/2401.12345'}},
    {doi:undefined,publication_year:2018},
    {doi:undefined,publication_year:undefined},
    {doi:undefined,authorships:[]},
  ]) {
    globalThis.fetch = async url => new URL(url).hostname === 'api.openalex.org'
      ? Response.json({results:[work({authorships:[{author:{display_name:'A & B'}}],...conflicting})]})
      : new Response(atom().replace('</entry>','<arxiv:doi>10.1234/attention</arxiv:doi></entry>'));
    const hits = await resolveImportQuery('Attention Is All You Need');
    assert.equal(hits.length,2,JSON.stringify(conflicting));
    assert.equal(automaticImportCandidate('Attention Is All You Need',hits),undefined);
  }
});

test('matching title author and year merge cross-provider metadata without a conflicting identity', async () => {
  globalThis.fetch = async url => new URL(url).hostname === 'api.openalex.org'
    ? Response.json({results:[work({authorships:[{author:{display_name:'a & b'}}]})]})
    : new Response(atom());
  const hits = await resolveImportQuery('Attention Is All You Need');
  assert.equal(hits.length,1);
  assert.ok(hits[0].oaPdfUrl);
});
