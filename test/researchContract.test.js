import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnalysisV2} from '../lib/analysisValidator.js';
import {researchFailure} from '../lib/researchContract.js';
test('unknown times and status never become fresh evidence',()=>{for(const timestamp of [null,'bad','2026-02-30T12:00:00Z',123]){const r=validateAnalysisV2({intro:'Evidence'}, {sources:[{type:'news',provider:'Supplied',timestamp}]});assert.equal(r.sources[0].timestamp,null);assert.equal(r.sources[0].freshness_seconds,null);assert.equal(r.sources[0].status,'unknown');}});
test('fetch time does not substitute for observation time',()=>{const r=validateAnalysisV2({}, {sources:[{type:'options',provider:'Bridge',fetched_at:'2026-01-01T12:00:00Z'}]});assert.equal(r.sources[0].timestamp,null);assert.equal(r.sources[0].fetched_at,'2026-01-01T12:00:00.000Z');});
test('future observations are not reported as zero seconds old',()=>{const r=validateAnalysisV2({}, {sources:[{type:'price',provider:'Feed',timestamp:'2099-01-01T12:00:00Z'}]});assert.equal(r.sources[0].freshness_seconds,null);});
test('confidence preserves zero and rejects invalid or absent values',()=>{for(const value of [undefined,NaN,Infinity,-1,2,'0.7'])assert.equal(validateAnalysisV2({bullish:'View',confidence:{bullish:value}}).meta.confidence.bullish,null);assert.equal(validateAnalysisV2({bullish:'View',confidence:{bullish:0}}).meta.confidence.bullish,0);});
test('provider failure returns no success-shaped analysis',()=>{const r=researchFailure('RESEARCH_UNAVAILABLE');assert.equal(r.success,false);assert.equal(r.analysis_v2,null);assert.equal(r.analysis,'');assert.equal(r.error.code,'RESEARCH_UNAVAILABLE');});
