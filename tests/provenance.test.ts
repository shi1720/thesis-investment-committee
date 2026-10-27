import test from 'node:test';
import assert from 'node:assert/strict';
import {researchPresentation} from '../lib/research/provenance';
import type {ResearchRun} from '../lib/contracts';
const base={profile:{mode:'live'},providers:[{name:'Meterless Nightshift',status:'unavailable'}],evidence:[{sample:false}]} as unknown as Pick<ResearchRun,'profile'|'providers'|'evidence'>;
test('a failed live model review never relabels observed source data as synthetic',()=>{
 const state=researchPresentation({...base,mode:'degraded'});
 assert.equal(state.hasObservedData,true);assert.equal(state.reviewIncomplete,true);assert.equal(state.label,'AI review incomplete');
});
test('real model calls over synthetic evidence keep synthetic data labels',()=>{
 const state=researchPresentation({...base,mode:'sample',providers:[{name:'Meterless Nightshift',status:'verified',detail:'real request'}],evidence:[{...base.evidence[0],sample:true}]});
 assert.equal(state.hasObservedData,false);assert.equal(state.reviewIncomplete,false);assert.equal(state.label,'Sample workspace');
});
