import assert from 'node:assert/strict';
import test from 'node:test';
import { browserPageContext, createBrowserPageContext, readPageMetadata } from '../src/content/browser-page-context.js';
import { collectAssetBatchItems } from '../src/content/batch-providers/index.js';

test('metadata respects native UTF-8 byte bounds and ignores invalid names without expanding the DOM list', () => {
  const element = (name, content) => ({ getAttribute: key => ({ name, content })[key] });
  const elements = { length: 1000000, 0: element('語'.repeat(100), '🙂'.repeat(1000)), 1: element('', 'ignored'), 2: element('bad\nname', 'ignored') };
  for (let index=3;index<64;index++) elements[index]=element('valid', 'okay');
  Object.defineProperty(elements, 64, { get() { throw new Error('unbounded metadata read'); } });
  const result=readPageMetadata({querySelectorAll:()=>elements});
  assert.equal(result.length,62);
  assert.ok(new globalThis.TextEncoder().encode(result[0].name).length <= 128);
  assert.ok(new globalThis.TextEncoder().encode(result[0].content).length <= 2048);
  assert.ok(!result[0].content.includes('\uFFFD'));
});

test('overlong Unicode page URL does not poison a Desktop batch or retain a previous provider', async () => {
  let calls=0;
  const state=createBrowserPageContext({resolve:async({pages})=>{calls++;return {pages:pages.map(page=>({...page,provider:'example'}))};}});
  await state.refresh({url:'https://example.test/a'});
  await state.refresh({url:'https://example.test/'+'語'.repeat(2000)});
  assert.equal(calls,1);
  assert.equal(state.get('https://example.test/a'),null);
});

test('managed galleries revalidate installed provider before any DOM reads or clicks', async t => {
  const originalChrome=globalThis.chrome;
  t.after(()=>{globalThis.chrome=originalChrome;browserPageContext.invalidate();});
  const url='https://example.test/gallery';
  const profile={url,provider:'community',profileVersion:'1@digest',gallery:{kind:'thumbnails'}};
  const options={locationContext:{href:url},documentContext:{querySelectorAll(selector) {
    assert.equal(selector,'meta[name], meta[property]','gallery DOM must not be touched');
    return [];
  }}};
  for (const replacement of [null, {...profile,provider:null,gallery:null}, {...profile,profileVersion:'2@new'}, {...profile,identity:{provider:'community',item_id:'changed'}}, {...profile,galleryKey:'changed'}, {...profile,url:'https://other.test/'}]) {
    globalThis.chrome={runtime:{sendMessage(message,callback) {
      assert.equal(message.type,'atlas-extension.browser-resolve');
      callback({ok:true,payload:{pages:replacement?[replacement]:[]}});
    }}};
    const context={managed:true,epoch:browserPageContext.token(),profile};
    await assert.rejects(collectAssetBatchItems(context,options),/provider changed/);
  }
});

test('provider lifecycle invalidation during batch preflight prevents the collector starting', async t => {
  const originalChrome=globalThis.chrome;
  t.after(()=>{globalThis.chrome=originalChrome;browserPageContext.invalidate();});
  const url='https://example.test/gallery';
  const profile={url,provider:'community',profileVersion:'1@digest',gallery:{kind:'thumbnails'}};
  let respond;
  globalThis.chrome={runtime:{sendMessage(_message,callback){respond=callback;}}};
  const context={managed:true,epoch:browserPageContext.token(),profile};
  const pending=collectAssetBatchItems(context,{locationContext:{href:url}});
  browserPageContext.invalidate();
  respond({ok:true,payload:{pages:[profile]}});
  await assert.rejects(pending,/provider changed/);
});
test('managed gallery result is rejected if Desktop identity changes during collection', async t => {
  const originalChrome=globalThis.chrome;
  t.after(()=>{globalThis.chrome=originalChrome;browserPageContext.invalidate();});
  const url='https://example.test/gallery';
  const gallery={kind:'thumbnails',imageSelector:'.image',thumbnailSelector:'.thumb',navigationSelector:'button',previousLabel:'Prev',nextLabel:'Next',indexParameter:'image',sourceMode:'src'};
  const profile={url,provider:'community',profileVersion:'1@digest',identity:{provider:'community',item_id:'original'},gallery};
  let calls=0;
  globalThis.chrome={runtime:{sendMessage(_message,callback) {
    calls++;
    callback({ok:true,payload:{pages:[calls===1?profile:{...profile,identity:{provider:'community',item_id:'replacement'}}]}});
  }}};
  const image={tagName:'IMG',src:'https://cdn.example.test/image.jpg',complete:true,naturalWidth:600,naturalHeight:400,
    getAttribute:name=>name==='src'?'https://cdn.example.test/image.jpg':null,
    getBoundingClientRect:()=>({width:600,height:400}),querySelector:()=>null,closest:()=>null};
  const documentContext={querySelectorAll:selector=>selector==='.image'?[image]:[]};
  await assert.rejects(collectAssetBatchItems({managed:true,epoch:browserPageContext.token(),profile},{documentContext,locationContext:{href:url}}),/provider changed/);
  assert.equal(calls,2);
});
