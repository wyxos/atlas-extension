import assert from 'node:assert/strict';
import test from 'node:test';
import { createThumbnailGallery } from '../src/content/gallery/thumbnails.js';
import { createSlotGallery } from '../src/content/gallery/slots.js';
import { galleryMedia } from '../src/content/gallery/media.js';
import { waitForGalleryCondition } from '../src/content/gallery/collection.js';

const pageUrl = 'https://gallery.example.test/view/sample?track=value#section';
const thumbSpec = { kind:'thumbnails', imageSelector:'.original', navigationSelector:'button,[role="button"]',
  previousLabel:'Earlier', nextLabel:'Later', indexParameter:'slide', sourceMode:'src', clearQuery:true,
  thumbnailSelector:'.strip img', thumbnailButtonSelector:'.thumb', thumbnailContainerSelector:'.strip', thumbnailContainerText:'Pictures' };
const slotSpec = { kind:'slots', rootSelector:'.gallery', rootIdentityAttribute:'data-post', rootIdentityPrefix:'entry-',
  assetAncestor:'.art', slotSelector:'.slide, .extra-slide', slotAttribute:'data-index', slotPrefix:'image-"',
  imageSelector:'.original', unsupportedSelector:'.moving-media', positionSelector:'.position', positionAttribute:'data-position',
  navigationSelector:'button,[role="button"]', previousLabel:'Earlier "image"', nextLabel:'Later "image"',
  indexParameter:'slide', sourceMode:'src', clearQuery:true };
const rect = () => ({width:800,height:600});
function image(src, extra = {}) {
  return { tagName:'IMG', src, complete:true, naturalWidth:800, naturalHeight:600, getBoundingClientRect:rect,
    getAttribute(name) { return name === 'src' ? this.src : name === 'srcset' ? this.srcset ?? null : null; },
    querySelector:()=>null, closest:()=>null, ...extra };
}
function thumbnailFixture({ count=3, start=1, mode='thumbnails', onClick=()=>{}, spec={}, unrelated=0, duplicates=0 } = {}) {
  let selected=start;
  const clicks=[];
  const gallerySpec={...thumbSpec,...spec};
  const location={href:`${pageUrl.split('?')[0]}?slide=${start}`};
  const images=Array.from({length:count},(_,i)=>image(`https://media.example.test/${i+1}.jpg`));
  const button=(target,label='')=>({click(){ selected=target; clicks.push(target); onClick(target); },
    getAttribute:name=>name==='aria-label'?label:null,getBoundingClientRect:rect});
  const buttons=images.map((_,i)=>button(i+1));
  const container={textContent:'Pictures'};
  const unrelatedContainer={textContent:'Pictures'};
  const thumbnails=images.map((_,i)=>image(`https://media.example.test/thumb-${i+1}.jpg`,{
    parentElement:container,
    closest:selector=>selector===gallerySpec.thumbnailButtonSelector?buttons[i]:selector===gallerySpec.thumbnailContainerSelector?container:null,
  }));
  for(let index=0;index<duplicates;index++) thumbnails.push(image(`https://media.example.test/thumb-${index%count+1}.jpg`,{
    parentElement:container,
    closest:selector=>selector===gallerySpec.thumbnailButtonSelector?button(index%count+1):selector===gallerySpec.thumbnailContainerSelector?container:null,
  }));
  const extra=Array.from({length:unrelated},(_,i)=>image(`https://media.example.test/unrelated-${i}.jpg`,{
    parentElement:unrelatedContainer,
    closest:selector=>selector===gallerySpec.thumbnailButtonSelector?button(999):selector===gallerySpec.thumbnailContainerSelector?unrelatedContainer:null,
  }));
  const root={isConnected:true,querySelectorAll(selector){
    if(selector===gallerySpec.imageSelector)return [images[selected-1]];
    if(selector===gallerySpec.thumbnailSelector)return mode==='thumbnails'?thumbnails:[];
    if(selector===gallerySpec.navigationSelector)return [selected>1?button(selected-1,gallerySpec.previousLabel):null,selected<count?button(selected+1,gallerySpec.nextLabel):null].filter(Boolean);
    return [];
  }};
  container.parentElement=root;
  images.forEach(value=>{value.parentElement=root;});
  const document={
    get images(){return [images[selected-1],image('https://unrelated.example.test/banner.jpg')];},
    querySelectorAll(selector){
      if(selector===gallerySpec.imageSelector)return [images[selected-1]];
      if(selector===gallerySpec.thumbnailSelector)return mode==='thumbnails'?[...thumbnails,...extra]:[];
      return root.querySelectorAll(selector);
    },
  };
  const profile={provider:'sampleprovider',url:pageUrl,gallery:gallerySpec};
  return {profile,documentContext:document,locationContext:location,images,root,container,thumbnails,clicks,current:()=>selected,waitForChange:async()=>true};
}
function slotFixture({missing=[],onClick=()=>{},count=3,start=1}={}) {
  let selected=start;
  const clicks=[];
  const indices=Array.from({length:count},(_,index)=>index+1);
  const images=indices.map(n=>image(`http://media.example.test/${n}.jpg`));
  const available=new Set(indices.filter(n=>!missing.includes(n)));
  const buttons=[['Earlier "image"',-1],['Later "image"',1]].map(([label,step])=>({
    getAttribute:name=>name==='aria-label'?label:name==='aria-disabled'?String(selected+step<1||selected+step>count):null,
    click(){selected+=step;clicks.push(selected);available.add(selected);onClick(selected);},
  }));
  const slots=indices.map(n=>({getAttribute:()=>`image-"${n}`,
    querySelector:selector=>selector===slotSpec.imageSelector&&available.has(n)?images[n-1]:null}));
  const carousel={isConnected:true,getAttribute:()=> 'entry-sample',querySelectorAll:selector=>{
    assert.equal(selector,slotSpec.slotSelector);return slots;
  },shadowRoot:{
    querySelector:selector=>{assert.equal(selector,slotSpec.positionSelector);return {getAttribute:()=>`${selected} of ${count}`};},
    querySelectorAll:selector=>{assert.equal(selector,slotSpec.navigationSelector);return [
      {getAttribute:()=> 'Unrelated',click(){throw Error('wrong control');}},...buttons];},
  }};
  const profile={provider:'sampleprovider',url:pageUrl,galleryKey:'sample',gallery:slotSpec};
  return {profile,context:{carousel,postId:'sample'},locationContext:new URL(pageUrl),images,clicks,current:()=>selected};
}

test('unknown thumbnail provider obeys selector, source mode, host scope and clean referrer',()=>{
  const fixture=thumbnailFixture({spec:{sourceMode:'srcset-highest',mediaHosts:['media.example.test']}});
  fixture.images[0].srcset='https://media.example.test/full.jpg 1600w';
  const current=createThumbnailGallery(fixture.profile).readCurrent(fixture);
  assert.equal(current.asset.source,'https://media.example.test/full.jpg');
  assert.equal(current.referrerUrl,'https://gallery.example.test/view/sample?slide=1');
  fixture.images[0].srcset='https://other.example.test/image.jpg 1600w';
  assert.equal(createThumbnailGallery(fixture.profile).readCurrent(fixture),null);
});

test('optional media hosts allow HTTP(S); explicit hosts require HTTPS and exact scope',()=>{
  assert.equal(galleryMedia(image('http://media.example.test/a.jpg'),{sourceMode:'src'},new URL(pageUrl)).source,'http://media.example.test/a.jpg');
  assert.equal(galleryMedia(image('http://media.example.test/a.jpg'),{sourceMode:'src',mediaHosts:['media.example.test']},new URL(pageUrl)),null);
  assert.equal(galleryMedia(image('https://media.example.test.evil.test/a.jpg'),{sourceMode:'src',mediaHosts:['media.example.test']},new URL(pageUrl)),null);
});

test('a cached main image moved outside the gallery or into its strip cannot be captured',()=>{
  for (const movedOutside of [false, true]) {
    const f = thumbnailFixture();
    const previous = f.images[0];
    previous.isConnected = true;
    previous.parentElement = movedOutside ? {} : f.container;
    const current = image('https://media.example.test/current.jpg', { parentElement: f.root });
    f.root.querySelectorAll = selector => selector === f.profile.gallery.imageSelector ? [current, previous] : [];
    const value = createThumbnailGallery(f.profile).readCurrent({ ...f,
      scope: { root: f.root, container: f.container, mainImage: previous } });
    assert.equal(value.asset.source, current.src);
  }
});

for (const [width, height] of [[300, 200], [800, 600], [1200, 800]]) {
test(`an unrelated ${width}x${height} video beside the main image cannot replace it`,()=>{
  const f = thumbnailFixture();
  const main = f.images[0];
  main.isConnected = true;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const video = image('https://media.example.test/sidebar.mp4', { tagName: 'VIDEO', parentElement: f.root,
    getBoundingClientRect: () => ({ left: 850, top: 0, width, height }) });
  f.root.querySelectorAll = selector => selector === 'video' ? [video] : selector === f.profile.gallery.imageSelector ? [main] : [];
  const value = createThumbnailGallery(f.profile).readCurrent({ ...f,
    scope: { root: f.root, container: f.container, mainImage: main } });
  assert.equal(value.asset.source, main.src);
  assert.equal(value.asset.type, 'image');
});
}

test('unknown provider query IDs keep distinct thumbnail, navigation and slot media',async()=>{
  for(const kind of ['thumbnails','navigation','slots']){
    const fixture=kind==='slots'?slotFixture():thumbnailFixture({mode:kind});
    fixture.images.forEach((value,index)=>{value.src=`https://media.example.test/image?id=${index+1}`;});
    fixture.thumbnails?.forEach((value,index)=>{value.src=`https://media.example.test/thumb?id=${index+1}`;});
    const collector=kind==='slots'?createSlotGallery(fixture.profile):createThumbnailGallery(fixture.profile);
    const items=await collector.collect(fixture);
    assert.deepEqual(items.map(item=>item.asset.source),[1,2,3].map(id=>`https://media.example.test/image?id=${id}`));
  }
});

test('unknown slot provider handles compound selectors and quoted labels without interpolated selectors',async()=>{
  const fixture=slotFixture({missing:[2,3]});
  const items=await createSlotGallery(fixture.profile).collect({...fixture,waitFor:async predicate=>predicate()});
  assert.deepEqual(items.map(item=>item.asset.source),[1,2,3].map(n=>`http://media.example.test/${n}.jpg`));
  assert.deepEqual(items.map(item=>item.referrerUrl),[1,2,3].map(n=>`https://gallery.example.test/view/sample?slide=${n}`));
  assert.equal(fixture.current(),1);
});

test('51 and 200 item thumbnail and navigation galleries stream in order and restore their middle selection',async()=>{
  for(const count of [51,200])for(const mode of ['thumbnails','navigation']){
    const fixture=thumbnailFixture({count,start:30,mode});
    const streamed=[];
    const progress=[];
    const items=await createThumbnailGallery(fixture.profile).collect({...fixture,
      onItem:async item=>{streamed.push(item);await Promise.resolve();},onProgress:update=>progress.push(update)});
    assert.deepEqual(items,[],'streaming avoids retaining a duplicate item array');
    assert.equal(streamed.length,count);
    assert.deepEqual(streamed.map(item=>Number(new URL(item.referrerUrl).searchParams.get('slide'))),Array.from({length:count},(_,index)=>index+1));
    assert.equal(fixture.current(),30);
    assert.ok(progress.some(update=>update.phase==='restoring'));
    assert.equal(progress.at(-1).collected,count);
    assert.equal(progress.at(-1).total,count);
  }
});

test('thumbnail collection scopes 30 images away from 60 unrelated and duplicate controls',async()=>{
  const fixture=thumbnailFixture({count:30,unrelated:60,duplicates:40});
  const collector=createThumbnailGallery(fixture.profile);
  const context=collector.resolve({...fixture,element:fixture.images[0]});
  assert.equal(context.root,fixture.root);
  assert.equal(context.container,fixture.container);
  const items=await collector.collect({...fixture,context});
  assert.equal(items.length,30);
  assert.ok(!fixture.clicks.includes(999));
});

test('ambiguous thumbnail containers fail without clicking or emitting',async()=>{
  const fixture=thumbnailFixture({unrelated:4});
  fixture.images.forEach(value=>{value.parentElement=null;});
  const collector=createThumbnailGallery(fixture.profile);
  assert.equal(collector.resolve({...fixture,element:fixture.images[0]}),null);
  await assert.rejects(collector.collect(fixture),{code:'BATCH_INCOMPLETE'});
  assert.deepEqual(fixture.clicks,[]);
});

test('unrelated clicked media does not inherit the page gallery',()=>{
  const fixture=thumbnailFixture();
  const unrelated=image('https://media.example.test/sidebar.jpg');
  assert.equal(createThumbnailGallery(fixture.profile).resolve({...fixture,element:unrelated}),null);
});

test('gallery waits observe DOM/media events and clean observers after success and cancellation',async()=>{
  let changed=false;let callback;let disconnected=0;
  const root=new globalThis.EventTarget();
  const documentContext={defaultView:{MutationObserver:class {
    constructor(check){callback=check;}
    observe(target,options){assert.equal(target,root);assert.equal(options.subtree,true);}
    disconnect(){disconnected++;}
  }}};
  const pending=waitForGalleryCondition(()=>changed,100,{roots:[root],documentContext});
  changed=true;callback();
  assert.equal(await pending,true);
  assert.equal(disconnected,1);
  changed=false;
  const abort=new globalThis.AbortController();
  const cancelled=waitForGalleryCondition(()=>changed,100,{roots:[root],documentContext,signal:abort.signal});
  abort.abort();
  await assert.rejects(cancelled,{code:'BATCH_CANCELLED'});
  assert.equal(disconnected,2);
  const eventWait=waitForGalleryCondition(()=>changed,100,{roots:[root],documentContext:{}});
  changed=true;root.dispatchEvent(new globalThis.Event('load'));
  assert.equal(await eventWait,true);
});

test('a single stalled gallery wait fails within its budget',async()=>{
  assert.equal(await waitForGalleryCondition(()=>false,1),false);
});

test('thumbnail context cancellation after a wait stops clicks and skips restoration',async()=>{
  const failure=Error('plugin disabled');let active=true;
  const fixture=thumbnailFixture({onClick:()=>{active=false;}});
  await assert.rejects(createThumbnailGallery(fixture.profile).collect({...fixture,assertActive:()=>{if(!active)throw failure;}}),error=>error===failure);
  assert.deepEqual(fixture.clicks,[2]);
});

test('navigation away cancels thumbnail collection without clicking the new page',async()=>{
  const fixture=thumbnailFixture({onClick:()=>{fixture.locationContext.href='https://gallery.example.test/view/another';}});
  await assert.rejects(createThumbnailGallery(fixture.profile).collect(fixture),{code:'BATCH_POST_CHANGED'});
  assert.deepEqual(fixture.clicks,[2]);
});

test('thumbnail restoration failure preserves the collection error',async()=>{
  const first=Error('capture failed');const cleanup=Error('restoration failed');let calls=0;
  const fixture=thumbnailFixture();
  await assert.rejects(createThumbnailGallery(fixture.profile).collect({...fixture,waitForChange:async()=>{throw ++calls===1?first:cleanup;}}),error=>error===first);
  assert.deepEqual(fixture.clicks,[2,1]);
});

test('thumbnail collection gives each navigation a fresh stall budget even past the old total deadline',async t=>{
  let now=0;const allowances=[];t.mock.method(Date,'now',()=>now);
  const fixture=thumbnailFixture({count:4});
  const items=await createThumbnailGallery(fixture.profile).collect({...fixture,waitForChange:async({timeoutMs})=>{allowances.push(timeoutMs);now+=31000;return true;}});
  assert.equal(items.length,4);
  assert.deepEqual(allowances,[30000,30000,30000,2500]);
  assert.deepEqual(fixture.clicks,[2,3,4,1]);
});

test('200 slot items stream with bounded navigation and progress past the old deadline',async t=>{
  let now=0;t.mock.method(Date,'now',()=>now);
  const fixture=slotFixture({count:200,start:70,missing:Array.from({length:200},(_,index)=>index+1)});
  const streamed=[];const progress=[];const allowances=[];
  const items=await createSlotGallery(fixture.profile).collect({...fixture,onItem:async item=>streamed.push(item),
    onProgress:update=>progress.push(update),waitFor:async(predicate,timeout)=>{allowances.push(timeout);now+=3000;return predicate();}});
  assert.deepEqual(items,[]);
  assert.equal(streamed.length,200);
  assert.equal(fixture.current(),70);
  assert.ok(allowances.every(value=>value===2500));
  assert.equal(progress[0].total,200);
  assert.deepEqual(progress.at(-1),{phase:'restoring',collected:200,total:200});
});

test('AbortSignal cancellation restores the original thumbnail and slot selection without further item callbacks',async()=>{
  for(const kind of ['thumbnail','slot']){
    const abort=new globalThis.AbortController();const streamed=[];const progress=[];
    const fixture=kind==='thumbnail'?thumbnailFixture({count:10,start:5}):slotFixture({count:10,start:5,missing:[1,2,3,4,6,7,8,9,10]});
    const collector=kind==='thumbnail'?createThumbnailGallery(fixture.profile):createSlotGallery(fixture.profile);
    await assert.rejects(collector.collect({...fixture,signal:abort.signal,waitFor:async predicate=>predicate(),
      onItem:async item=>streamed.push(item),onProgress:update=>{
        progress.push(update);if(update.phase==='collecting'&&update.collected===2)abort.abort();
      }}),{code:'BATCH_CANCELLED'});
    assert.equal(streamed.length,2);
    assert.equal(fixture.current(),5);
    assert.equal(progress.at(-1).phase,'restoring');
  }
});

test('navigation loops fail and restore instead of emitting an endless or partial success',async()=>{
  const fixture=thumbnailFixture({mode:'navigation',count:3,onClick:target=>{
    if(target===3)fixture.images[2].src=fixture.images[0].src;
  }});
  await assert.rejects(createThumbnailGallery(fixture.profile).collect(fixture),{code:'BATCH_INCOMPLETE'});
  assert.equal(fixture.current(),1);
});

test('changed thumbnail item sets fail before emitting a changed-gallery item',async()=>{
  const fixture=thumbnailFixture({onClick:target=>{if(target===2)fixture.thumbnails.pop();}});
  const streamed=[];
  await assert.rejects(createThumbnailGallery(fixture.profile).collect({...fixture,onItem:async item=>streamed.push(item)}),{code:'BATCH_INCOMPLETE'});
  assert.equal(streamed.length,1);
  assert.equal(fixture.current(),1);
});

test('slot context cancellation is checked after injected waits and skips restoration',async()=>{
  const failure=Error('plugin removed');let active=true;
  const fixture=slotFixture({missing:[2]});
  await assert.rejects(createSlotGallery(fixture.profile).collect({...fixture,
    assertActive:()=>{if(!active)throw failure;},waitFor:async()=>{active=false;return true;}}),error=>error===failure);
  assert.deepEqual(fixture.clicks,[2]);
});

test('slot restoration failure cannot replace the original collection error',async()=>{
  const first=Error('collection failure');const cleanup=Error('cleanup failure');let calls=0;
  const fixture=slotFixture({missing:[2]});
  await assert.rejects(createSlotGallery(fixture.profile).collect({...fixture,waitFor:async()=>{throw ++calls===1?first:cleanup;}}),error=>error===first);
  assert.deepEqual(fixture.clicks,[2,1]);
});

test('an already invalid context never starts either collection engine',async()=>{
  const failure=Error('stale page');const assertActive=()=>{throw failure;};
  const thumbnails=thumbnailFixture();
  await assert.rejects(createThumbnailGallery(thumbnails.profile).collect({...thumbnails,assertActive}),error=>error===failure);
  assert.deepEqual(thumbnails.clicks,[]);
  const slots=slotFixture({missing:[2]});
  await assert.rejects(createSlotGallery(slots.profile).collect({...slots,assertActive}),error=>error===failure);
  assert.deepEqual(slots.clicks,[]);
});

test('an explicit user source preference overrides the plugin gallery default', async t => {
  const { initializeAssetSourcePreferences } = await import('../src/content/assets.js');
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {storage:{local:{get:async key=>({[key]:{
    version:3,domains:['gallery.example.test'],profiles:[{domain:'gallery.example.test',asset:{imageSourcePreference:'src'}}],
  }})}}};
  t.after(async()=>{
    globalThis.chrome={storage:{local:{get:async()=>({})}}};
    await initializeAssetSourcePreferences();
    globalThis.chrome=previousChrome;
  });
  await initializeAssetSourcePreferences();
  const asset=image('https://media.example.test/declared.jpg',{srcset:'https://media.example.test/large.jpg 1600w'});
  assert.equal(galleryMedia(asset,{sourceMode:'srcset-highest'},new URL(pageUrl)).source,'https://media.example.test/declared.jpg');
});
