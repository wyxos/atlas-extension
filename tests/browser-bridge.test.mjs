import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserPageContext, readPageMetadata } from '../src/content/browser-page-context.js';
import { createBrowserResolutionCache } from '../src/shared/browser-resolution-cache.js';
import { createDesktopTransport } from '../src/background/desktop-transport.js';
import { createContentInterestRegistry } from '../src/background/content-interest-registry.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const page = (url, extra={}) => ({ url, canonicalPage:url, provider:null, identity:null, gallery:null,...extra });
test('generic browser observes bounded metadata only, without DOM markup, values or cookies', () => {
 const element = { getAttribute:name=>name==='name'?'example:identity':'x'.repeat(3000) };
 const metadata=readPageMetadata({ querySelectorAll:()=>Array(100).fill(element), cookie:'must-not-transfer', outerHTML:'must-not-transfer' });
 assert.equal(metadata.length,64); assert.ok(metadata.every(x=>x.content.length<=2048));
 assert.deepEqual(Object.keys(metadata[0]),['name','content']);
});
test('provider resolution coalesces unchanged observations and drops responses from a previous page',async()=>{
 const first=deferred(); let count=0;
 const state=createBrowserPageContext({resolve:async({pages})=>{ count++; return pages[0].url.endsWith('/one')?first.promise:{pages:[page(pages[0].url,{provider:'unrecognized'})]}; }});
 const pending=state.refresh({url:'https://fixture.test/one'});
 const duplicate=state.refresh({url:'https://fixture.test/one'});
 await state.refresh({url:'https://fixture.test/two'});
 first.resolve({pages:[page('https://fixture.test/one',{provider:'obsolete'})]});
 await Promise.all([pending,duplicate]);
 assert.equal(count,2); assert.equal(state.get('https://fixture.test/one'),null);
 assert.equal(state.get('https://fixture.test/two').provider,'unrecognized');
});
test('plugin removal invalidates both current profile and outstanding resolution',async()=>{
 const wait=deferred(); const state=createBrowserPageContext({resolve:()=>wait.promise});
 const request=state.refresh({url:'https://fixture.test/one'}); state.invalidate();
 wait.resolve({pages:[page('https://fixture.test/one',{provider:'removed'})]}); await request;
 assert.equal(state.get('https://fixture.test/one'),null);
});
test('offline resolution preserves generic capture and waits for resync before retrying',async()=>{
 let count=0; const state=createBrowserPageContext({resolve:async()=>{count++;throw new Error('offline');}});
 await state.refresh({url:'https://fixture.test/one'}); await state.refresh({url:'https://fixture.test/one'});
 assert.equal(count,1);assert.equal(state.get('https://fixture.test/one'),null);
 state.invalidate();await state.refresh({url:'https://fixture.test/one'});assert.equal(count,2);
});
test('mismatched and incomplete Desktop responses never attach another page identity',async()=>{
 const state=createBrowserPageContext({resolve:async()=>({pages:[page('https://other.test/') ]})});
 await state.refresh({url:'https://fixture.test/'});assert.equal(state.get('https://fixture.test/'),null);
});
test('canonical resolution batches at100 and retains no provider-specific matching code',async()=>{
 const calls=[];const cache=createBrowserResolutionCache({resolve:async({pages})=>{calls.push(pages.length);return {pages:pages.map(({url})=>page(url,{canonicalPage:'unknown:'+new URL(url).pathname}))};}});
 const urls=Array.from({length:205},(_,i)=>`https://fixture.test/${i}`);
 await cache.prepare(urls);await cache.prepare(urls);
 assert.deepEqual(calls,[100,100,5]);assert.equal(cache.canonical(urls[42]),'unknown:/42');
 cache.clear();assert.equal(cache.canonical(urls[42]),urls[42]);
});
test('clearing canonical cache prevents an old account response restoring aliases',async()=>{
 const wait=deferred();const cache=createBrowserResolutionCache({resolve:()=>wait.promise});
 const pending=cache.prepare(['https://fixture.test/']);await Promise.resolve();cache.clear();
 wait.resolve({pages:[page('https://fixture.test/',{canonicalPage:'old:1'})]});await pending;
 assert.equal(cache.canonical('https://fixture.test/'),'https://fixture.test/');
});
test('canonical mapping changes rebuild event indexes without stale delivery or cross-tab matches',async()=>{
 const mapping=new Map([['https://fixture.test/one?variant=1','example:one']]);
 const registry=createContentInterestRegistry({storageArea:null,canonicalProviderPage:url=>mapping.get(url)??url});await registry.ready;
 registry.register({tabId:1,documentId:'one',sequence:1,referrerUrls:['https://fixture.test/one?variant=1']});
 mapping.set('https://fixture.test/one','example:one');registry.reindexReferrers();
 assert.deepEqual(registry.matchingTabIds({referrerUrl:'https://fixture.test/one'}),[1]);
 mapping.clear();registry.reindexReferrers();assert.deepEqual(registry.matchingTabIds({referrerUrl:'https://fixture.test/one'}),[]);
});
test('browser provider endpoint uses the paired local transport and keeps tokens out of page data',async()=>{
 let request;
 const transport=createDesktopTransport({channel:'dev',fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200,json:async()=>({ok:true,data:{pages:[page('https://fixture.test/')]}})};}});
 await transport.resolveBrowserPages({channel:'dev',clientId:'fixture-client',clientToken:'fixture-secret'},{pages:[{url:'https://fixture.test/'}]});
 assert.equal(request.url,'http://127.0.0.1:17420/v1/browser/resolve');
 assert.equal(request.options.headers.Authorization,'Bearer fixture-secret');
 assert.ok(!request.options.body.includes('fixture-secret'));
});
