import assert from 'node:assert/strict';
import test from 'node:test';
import { createThumbnailGallery } from '../src/content/gallery/thumbnails.js';
import { createSlotGallery } from '../src/content/gallery/slots.js';
import { galleryMedia } from '../src/content/gallery/media.js';

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
function thumbnailFixture({ count=3, start=1, mode='thumbnails', onClick=()=>{}, spec={} } = {}) {
  let selected=start;
  const clicks=[];
  const gallerySpec={...thumbSpec,...spec};
  const location={href:pageUrl};
  const images=Array.from({length:count},(_,i)=>image(`https://media.example.test/${i+1}.jpg`));
  const button=(target,label='')=>({click(){ selected=target; clicks.push(target); onClick(target); },
    getAttribute:name=>name==='aria-label'?label:null,getBoundingClientRect:rect});
  const buttons=images.map((_,i)=>button(i+1));
  const thumbnails=images.map((_,i)=>image(`https://media.example.test/thumb-${i+1}.jpg`,{
    closest:selector=>selector===gallerySpec.thumbnailButtonSelector?buttons[i]:selector===gallerySpec.thumbnailContainerSelector?{textContent:'Pictures'}:null,
  }));
  const document={
    images:[image('https://unrelated.example.test/banner.jpg')],
    querySelectorAll(selector){
      if(selector===gallerySpec.imageSelector)return [images[selected-1]];
      if(selector===gallerySpec.thumbnailSelector)return mode==='thumbnails'?thumbnails:[];
      if(selector===gallerySpec.navigationSelector)return [selected>1?button(selected-1,gallerySpec.previousLabel):null,selected<count?button(selected+1,gallerySpec.nextLabel):null].filter(Boolean);
      return [];
    },
  };
  const profile={provider:'sampleprovider',url:pageUrl,gallery:gallerySpec};
  return {profile,documentContext:document,locationContext:location,images,clicks,current:()=>selected,waitForChange:async()=>true};
}
function slotFixture({missing=[],onClick=()=>{}}={}) {
  let selected=1;
  const clicks=[];
  const images=[1,2,3].map(n=>image(`http://media.example.test/${n}.jpg`));
  const available=new Set([1,2,3].filter(n=>!missing.includes(n)));
  const buttons=[['Earlier "image"',-1],['Later "image"',1]].map(([label,step])=>({
    getAttribute:name=>name==='aria-label'?label:name==='aria-disabled'?String(selected+step<1||selected+step>3):null,
    click(){selected+=step;clicks.push(selected);available.add(selected);onClick(selected);},
  }));
  const slots=[1,2,3].map(n=>({getAttribute:()=>`image-"${n}`,
    querySelector:selector=>selector===slotSpec.imageSelector&&available.has(n)?images[n-1]:null}));
  const carousel={isConnected:true,getAttribute:()=> 'entry-sample',querySelectorAll:selector=>{
    assert.equal(selector,slotSpec.slotSelector);return slots;
  },shadowRoot:{
    querySelector:selector=>{assert.equal(selector,slotSpec.positionSelector);return {getAttribute:()=>`${selected} of 3`};},
    querySelectorAll:selector=>{assert.equal(selector,slotSpec.navigationSelector);return [
      {getAttribute:()=> 'Unrelated',click(){throw Error('wrong control');}},...buttons];},
  }};
  const profile={provider:'sampleprovider',url:pageUrl,galleryKey:'sample',gallery:slotSpec};
  return {profile,context:{carousel,postId:'sample'},locationContext:new URL(pageUrl),clicks,current:()=>selected};
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

test('unknown slot provider handles compound selectors and quoted labels without interpolated selectors',async()=>{
  const fixture=slotFixture({missing:[2,3]});
  const items=await createSlotGallery(fixture.profile).collect({...fixture,waitFor:async predicate=>predicate()});
  assert.deepEqual(items.map(item=>item.asset.source),[1,2,3].map(n=>`http://media.example.test/${n}.jpg`));
  assert.deepEqual(items.map(item=>item.referrerUrl),[1,2,3].map(n=>`https://gallery.example.test/view/sample?slide=${n}`));
  assert.equal(fixture.current(),1);
});

test('oversized thumbnail and navigation galleries never return partial batches',async()=>{
  const thumbnails=thumbnailFixture({count:51});
  await assert.rejects(createThumbnailGallery(thumbnails.profile).collect(thumbnails),{code:'BATCH_TOO_LARGE'});
  assert.deepEqual(thumbnails.clicks,[]);
  const navigation=thumbnailFixture({count:51,mode:'navigation'});
  await assert.rejects(createThumbnailGallery(navigation.profile).collect(navigation),{code:'BATCH_TOO_LARGE'});
  assert.equal(navigation.current(),1);
  assert.equal(navigation.clicks.length,100);
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

test('thumbnail collection has one total deadline and a separate short restoration budget',async t=>{
  let now=0;const allowances=[];t.mock.method(Date,'now',()=>now);
  const fixture=thumbnailFixture({count:4});
  await assert.rejects(createThumbnailGallery(fixture.profile).collect({...fixture,waitForChange:async({timeoutMs})=>{allowances.push(timeoutMs);now+=31000;return true;}}),{code:'BATCH_INCOMPLETE'});
  assert.deepEqual(allowances,[30000,29000,2500]);
  assert.deepEqual(fixture.clicks,[2,3,1]);
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
