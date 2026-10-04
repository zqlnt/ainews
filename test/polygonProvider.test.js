import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot,normalizeSnapshot,observationTime} from '../lib/polygonSnapshot.js';
import {createPolygonProvider} from '../lib/polygonProvider.js';

const asOf=Date.parse('2026-10-03T12:00:00Z');
const ns=ms=>String(BigInt(ms)*1000000n);
const option=(ticker='O:TESTC',type='call')=>({
 details:{ticker,contract_type:type,strike_price:100,expiration_date:'2026-10-16',shares_per_contract:100},
 underlying_asset:{ticker:'TEST',price:101,last_updated:ns(asOf-60000),timeframe:'DELAYED'},
 implied_volatility:.25,open_interest:100,
 last_quote:{bid:2,ask:3,last_updated:ns(asOf-120000),timeframe:'DELAYED'},
 last_trade:{price:2.5,sip_timestamp:ns(asOf-180000)},day:{volume:20,last_updated:ns(asOf-240000)}
});
const page=(results,next_url)=>({ok:true,json:async()=>({status:'OK',results,...(next_url?{next_url}:{})})});
const chain=(pages,opts={})=>{let n=0;const calls=[];return {calls,run:()=>collectSnapshot({symbol:'TEST',apiKey:'test-only',now:()=>asOf,fetchImpl:async(url,init)=>{calls.push({url,init});return pages[n++];},...opts})};};

test('collects beyond three pages with explicit complete coverage and header authentication',async()=>{
 const c=chain(Array.from({length:5},(_,i)=>page([option('O:'+i)],i<4?'https://api.polygon.io/v3/snapshot/options/TEST?cursor='+i:undefined)));
 const r=await c.run();assert.equal(r.coverage.complete,true);assert.equal(r.coverage.pages,5);assert.equal(r.contracts.length,5);
 assert.ok(c.calls.every(c=>!c.url.includes('test-only')&&c.init.headers.Authorization==='Bearer test-only'&&c.init.redirect==='error'));
});
test('page budgets and failed pages cannot masquerade as a complete chain',async()=>{
 const c=chain([page([option()],'https://api.polygon.io/v3/snapshot/options/TEST?cursor=2')],{maxPages:1});
 assert.equal((await c.run()).coverage.reason,'page_limit');
 const r=await chain([page([option()],'https://api.polygon.io/v3/snapshot/options/TEST?cursor=2'),{ok:false,status:403}]).run();
 assert.equal(r.coverage.complete,false);assert.equal(r.coverage.reason,'http_403');
});
test('untrusted pagination destinations never receive a credential',async()=>{
 for(const url of ['https://evil.example/steal','https://api.polygon.io/v3/other','http://api.polygon.io/v3/snapshot/options/TEST','https://user@api.polygon.io/v3/snapshot/options/TEST']){
  const c=chain([page([option()],url)]);const r=await c.run();assert.equal(r.coverage.reason,'unsafe_next_url');assert.equal(c.calls.length,1);
 }
});
test('cycles and duplicate contracts report incomplete coverage',async()=>{
 const next='https://api.polygon.io/v3/snapshot/options/TEST?cursor=2';
 assert.equal((await chain([page([option()],next),page([option('O:2')],next)]).run()).coverage.reason,'pagination_cycle');
 assert.equal((await chain([page([option(),option()])]).run()).coverage.reason,'duplicate_contracts');
});
test('provider observation times are retained independently from collection time',()=>{
 const r=normalizeSnapshot([option()],'TEST',asOf);
 assert.equal(r.spot,101);assert.equal(r.spotObservedAt,'2026-10-03T11:59:00.000Z');assert.equal(r.dataTimestamp,'2026-10-03T11:58:00.000Z');
 assert.equal(observationTime(ns(asOf+1),asOf),null);assert.equal(observationTime(null,asOf),null);
});
test('missing values stay unknown and conflicting underlying observations do not select an arbitrary spot',()=>{
 const a=option();delete a.open_interest;delete a.implied_volatility;delete a.last_quote;delete a.day;delete a.underlying_asset;
 const r=normalizeSnapshot([a],'TEST',asOf);assert.equal(r.spot,null);assert.equal(r.rows[0].oi,null);assert.equal(r.rows[0].volume,null);assert.equal(r.rows[0].iv,null);assert.equal(r.rows[0].quoteObservedAt,null);
 const b=option('O:B');b.underlying_asset.price=102;assert.equal(normalizeSnapshot([option(),b],'TEST',asOf).spot,null);
});
test('crossed quotes, malformed expiry dates and nonstandard multipliers are flagged',()=>{
 const a=option();a.last_quote.bid=4;const b=option('O:B');b.details.expiration_date='2026-02-30';const c=option('O:C');c.details.shares_per_contract=10;
 const r=normalizeSnapshot([a,b,c],'TEST',asOf);assert.equal(r.rows[0].bid,null);assert.equal(r.counts.invalidContract,1);assert.equal(r.counts.nonstandardContract,1);
});
test('provider suppresses metrics when chain coverage is incomplete',async()=>{
 const provider=createPolygonProvider({now:()=>asOf,getKey:()=> 'test-only',maxPages:1,fetchImpl:async()=>page([option()],'https://api.polygon.io/v3/snapshot/options/TEST?cursor=2')});
 const r=await provider('TEST');assert.equal(r.rows.length,0);assert.equal(r.atmIV,null);assert.equal(r.quality.usableForAggregates,false);
});
test('unknown IV and OI suppress weighted aggregates; unknown quotes are not replaced by trades',async()=>{
 const a=option();delete a.implied_volatility;delete a.open_interest;delete a.last_quote;
 const provider=createPolygonProvider({now:()=>asOf,getKey:()=> 'test-only',fetchImpl:async()=>page([a,option('O:P','put')])});
 const r=await provider('TEST');assert.equal(r.ivTermStructure,null);assert.equal(r.totalDelta,null);assert.equal(r.impliedMove,null);assert.equal(r.quality.usableForAggregates,false);
});
test('concurrent requests share a collection and returned data cannot mutate cached observations',async()=>{
 let calls=0;const provider=createPolygonProvider({now:()=>asOf,getKey:()=> 'test-only',fetchImpl:async()=>{calls++;return page([option()]);}});
 const [a,b]=await Promise.all([provider('TEST'),provider('TEST')]);a.rows[0].oi=999;assert.equal(b.rows[0].oi,100);assert.equal((await provider('TEST')).rows[0].oi,100);assert.equal(calls,1);
});
test('stale fallback retains original timestamps; removed credentials invalidate cached data',async()=>{
 let time=asOf,key='test-only',calls=0;
 const provider=createPolygonProvider({now:()=>time,getKey:()=>key,freshSeconds:1,staleSeconds:10,fetchImpl:async()=>++calls===1?page([option()]):{ok:false,status:503}});
 const a=await provider('TEST');time+=2000;const b=await provider('TEST');assert.equal(b.isStale,true);assert.equal(b.fetchedAt,a.fetchedAt);assert.equal(b.dataTimestamp,a.dataTimestamp);
 key=null;assert.equal((await provider('TEST')).rows.length,0);
});
test('missing underlying observation does not fall back to the previous stock close',async()=>{
 const a=option();delete a.underlying_asset.last_updated;let calls=0;
 const provider=createPolygonProvider({now:()=>asOf,getKey:()=> 'test-only',fetchImpl:async()=>{calls++;return page([a]);}});
 const r=await provider('TEST');assert.equal(r.spot,null);assert.equal(r.atmIV,null);assert.equal(calls,1);
});
test('quoted straddle cost agrees with hand-calculated bid/ask midpoints',async()=>{
 const provider=createPolygonProvider({now:()=>asOf,getKey:()=> 'test-only',fetchImpl:async()=>page([option(),option('O:P','put')])});
 const r=await provider('TEST');
 // Two contracts at (2 + 3) / 2 = 2.5 each; total 5, or 4.95049...% of spot 101.
 assert.equal(r.impliedMove.abs,5);assert.equal(r.impliedMove.pct,5);
 assert.equal(r.quality.verifiedPointInTime,false);
});
