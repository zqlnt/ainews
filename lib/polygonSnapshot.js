// Provider boundary: no guessed observation timestamps, previous-close spot or silent truncation.
const DAY = 86_400_000;
const HOSTS = new Set(['api.polygon.io','api.massive.com']);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const nonnegative = x => finite(x) && x >= 0 ? x : null;
const positive = x => finite(x) && x > 0 ? x : null;
const isoDay = x => typeof x === 'string' && /^\d{4}-\d\d-\d\d$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;

/** Provider timestamps are nanoseconds. Precision is only claimed to milliseconds. */
export function observationTime(value, receivedAt) {
  if ((!finite(value) && !(typeof value === 'string' && /^\d+$/.test(value))) || Number(value) <= 0) return null;
  const ms = Math.floor(Number(value) / 1e6);
  if (!Number.isSafeInteger(ms) || ms > receivedAt || ms < Date.UTC(1970,0,1)) return null;
  return new Date(ms).toISOString();
}

/** Normalise vendor observations; missing numbers stay null, never zero. */
export function normalizeSnapshot(contracts, symbol, asOf) {
  const rows=[], flags=new Set(), counts={outsideWindow:0,invalidContract:0,nonstandardContract:0};
  const underlying=[];
  for (const contract of contracts) {
    const d=contract?.details;
    if (!d || !isoDay(d.expiration_date) || !positive(d.strike_price) || !['call','put'].includes(d.contract_type) || typeof d.ticker!=='string') {counts.invalidContract++;continue;}
    const expiryUTC=d.expiration_date+'T00:00:00.000Z',ttmDays=(Date.parse(expiryUTC)-asOf)/DAY;
    // Preserve the legacy date-only horizon explicitly. This does not model 0DTE exercise/settlement.
    if (ttmDays<=0 || ttmDays>30) {counts.outsideWindow++;continue;}
    if (d.shares_per_contract!==100) {counts.nonstandardContract++;continue;}
    const asset=contract.underlying_asset||{},assetAt=observationTime(asset.last_updated,asOf);
    if (asset.ticker===symbol && positive(asset.price) && assetAt) underlying.push({price:asset.price,observedAt:assetAt,timeframe:typeof asset.timeframe==='string'?asset.timeframe:null});
    const quote=contract.last_quote||{},quoteAt=observationTime(quote.last_updated,asOf);
    const trade=contract.last_trade||{},tradeAt=observationTime(trade.sip_timestamp,asOf);
    const dayAt=observationTime(contract.day?.last_updated,asOf);
    let bid=nonnegative(quote.bid),ask=nonnegative(quote.ask);
    if (bid!==null && ask!==null && bid>ask) {bid=null;ask=null;flags.add('crossed_quote');}
    if (!quoteAt) flags.add('quote_observation_time_unknown');
    if (!dayAt) flags.add('daily_bar_observation_time_unknown');
    const oi=nonnegative(contract.open_interest),volume=nonnegative(contract.day?.volume),iv=positive(contract.implied_volatility);
    if (oi===null) flags.add('open_interest_unknown');
    if (volume===null) flags.add('volume_unknown');
    if (iv===null) flags.add('implied_volatility_unknown');
    rows.push({contract:d.ticker,expiryUTC,ttmDays,strike:d.strike_price,type:d.contract_type,iv,oi,volume,bid,ask,lastPrice:positive(trade.price),
      quoteObservedAt:quoteAt,tradeObservedAt:tradeAt,dailyBarObservedAt:dayAt,underlyingObservedAt:assetAt,contractMultiplier:100,
      quoteTimeframe:typeof quote.timeframe==='string'?quote.timeframe:null,openInterestAsOf:'previous_trading_day_unspecified',
      expiryConvention:'provider_date_at_00_00_UTC_not_settlement_time'});
  }
  rows.sort((a,b)=>a.contract.localeCompare(b.contract));
  underlying.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||a.price-b.price);
  let spotRecord=underlying[0]??null;
  if (spotRecord && underlying.some(x=>x.observedAt===spotRecord.observedAt&&x.price!==spotRecord.price)) {flags.add('conflicting_underlying_prices');spotRecord=null;}
  if (!spotRecord) flags.add('underlying_observation_unavailable');
  const times=rows.flatMap(r=>[r.quoteObservedAt,r.tradeObservedAt,r.dailyBarObservedAt]).filter(Boolean).sort();
  if (counts.invalidContract) flags.add('invalid_contracts_excluded');
  if (counts.nonstandardContract) flags.add('nonstandard_contracts_excluded');
  return {rows,spot:spotRecord?.price??null,spotObservedAt:spotRecord?.observedAt??null,spotTimeframe:spotRecord?.timeframe??null,
    dataTimestamp:times.at(-1)??null,oldestObservationAt:times[0]??null,counts,flags:[...flags].sort()};
}

/** Traverse a bounded provider chain. A budget, failed page or duplicate makes coverage incomplete. */
export async function collectSnapshot({symbol,apiKey,fetchImpl,now=Date.now,maxPages=40,timeoutMs=15000,totalTimeoutMs=60000}) {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw Error('Invalid underlying symbol.');
  if (!Number.isInteger(maxPages)||maxPages<1||maxPages>100) throw Error('Invalid page limit.');
  const started=now(),path='/v3/snapshot/options/'+encodeURIComponent(symbol);
  const first=new URL('https://api.polygon.io'+path);
  first.searchParams.set('limit','250');first.searchParams.set('sort','ticker');first.searchParams.set('order','asc');
  first.searchParams.set('expiration_date.gte',new Date(started).toISOString().slice(0,10));
  first.searchParams.set('expiration_date.lte',new Date(started+30*DAY).toISOString().slice(0,10));
  const contracts=[],seenURLs=new Set(),seenContracts=new Set(); let next=first.href,pages=0,complete=false,reason=null,duplicates=0;
  while(next) {
    if(pages>=maxPages){reason='page_limit';break;}
    const remaining=totalTimeoutMs-(now()-started);if(remaining<=0){reason='collection_timeout';break;}
    let url;
    try{url=new URL(next);}catch{reason='unsafe_next_url';break;}
    if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.port||url.username||url.password||url.pathname!==path){reason='unsafe_next_url';break;}
    url.hash='';url.searchParams.delete('apiKey');url.searchParams.sort();
    if(seenURLs.has(url.href)){reason='pagination_cycle';break;}seenURLs.add(url.href);
    try {
      const response=await fetchImpl(url.href,{headers:{Authorization:'Bearer '+apiKey},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,remaining))),size:2_000_000});
      if(!response.ok){reason='http_'+response.status;break;}
      const data=await response.json();
      if(data?.status!=='OK'||!Array.isArray(data.results)||data.results.length>250){reason='invalid_page';break;}
      if(data.next_url!==undefined&&data.next_url!==null&&typeof data.next_url!=='string'){reason='invalid_next_url';break;}
      pages++;
      for(const contract of data.results){
        const id=contract?.details?.ticker;
        if(typeof id==='string'&&seenContracts.has(id)){duplicates++;continue;}
        if(typeof id==='string')seenContracts.add(id);
        contracts.push(contract);
      }
      next=data.next_url||null;
      if(!next){complete=duplicates===0;reason=duplicates?'duplicate_contracts':null;}
    }catch{reason='request_failed';break;}
  }
  return {contracts,startedAt:started,receivedAt:now(),coverage:{complete,pages,receivedContracts:contracts.length,duplicates,reason,maxPages,
    scope:'standard_100_share_contracts_with_0_lt_calendar_days_lte_30',expiryFrom:first.searchParams.get('expiration_date.gte'),expiryThrough:first.searchParams.get('expiration_date.lte')}};
}
