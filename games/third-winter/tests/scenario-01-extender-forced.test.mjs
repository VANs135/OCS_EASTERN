import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { dnieperOpeningChoices, prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { openCampaignMatch, applyCampaignTurn } from '../src/match/campaign-match.ts'
import { dnieperExtenderBoard } from '../src/match/dnieper-extender.ts'
import { dnieperCampaignBoards } from '../src/match/dnieper-campaign-boards.ts'
import { campaignForcedExtenderCollapseOptions, convertCampaignExtender } from '../src/match/campaign-extender.ts'

const ROOT='D:/war game/OCS各作数据库/OCS第三个冬天'; const SCENARIO='01-dnepr-battles'
const read=async(...p)=>JSON.parse((await readFile(join(ROOT,...p),'utf8')).replace(/^\uFEFF/,''))
async function load(){ const [hexes,edges,catalog,setupRaw]=await Promise.all([read('地图数据库','map_hexes.json'),read('地图数据库','map_edges.json'),loadThirdWinterV2Units(f=>read('data',f)),read('scenarios',SCENARIO,'setup.json')]); const map=indexTtwCampaignMap(hexes,edges); const playable=campaignMapInPlayArea(map,ttwCampaignPlayArea(SCENARIO)); const setup=prepareCampaignSetup(setupRaw,catalog.aliases,map,playable); return {map,playable,catalog,setup,setupRaw} }

test('scenario 01 9.14d forces an extender collapse on enemy entry and only the owner settles it', async()=>{
  const loaded=await load(); const choices=dnieperOpeningChoices(loaded)
  const trucks=choices.find(c=>c.kind==='transport'&&c.definition.endsWith('tp_003')); assert.ok(trucks)
  const state=openCampaignMatch(prepareDnieperBoard(loaded),createRngState(1)).state
  const truckIds=Object.keys(state.counters).filter(id=>id.startsWith(`01-optional:${trucks.id}:`)).slice(0,5); assert.equal(truckIds.length,5)
  const hex=loaded.playable.resolveHex('B41.06'); assert.ok(hex)
  const counters={...state.counters}
  for(const id of truckIds) counters[id]={...counters[id],location:{kind:'map',hex}}
  const attack=loaded.setup.counters.find(c=>c.ref==='Sov 53 MC Rgt'); assert.ok(attack)
  const attackerId=Object.keys(state.counters).find(id=>state.counters[id].side==='soviet'&&state.counters[id].definition===attack.definition); assert.ok(attackerId)
  counters[attackerId]={...counters[attackerId],location:{kind:'map',hex}}
  const base={...state,counters,cursor:{first:'soviet',phasing:'axis',phase:'movement'},movementSegment:'movement'}
  const trace=(_state,side,hex)=>side==='axis'&&hex===loaded.playable.resolveHex('B42.06')
  const extenderBoard=dnieperExtenderBoard(loaded.playable,loaded.catalog.definitions,{hasTrace:trace})
  const converted=convertCampaignExtender(base,'axis',{type:'convert-campaign-extender',hex,kind:'truck',count:1},extenderBoard)
  assert.equal(converted.extenders.length,1)
  const boards=dnieperCampaignBoards(loaded,{hasTrace:trace})
  const forced=boards.groundMovement?.afterMove?.(converted,'soviet',{path:[hex],
    movers:[{id:attackerId,combat:true,stepsLeft:0}],placements:[{id:attackerId,hex}]})??converted
  assert.equal(forced.forcedExtenderCollapse.owner,'axis')
  assert.equal(forced.forcedExtenderCollapse.captor,'soviet')
  assert.equal(forced.forcedExtenderCollapse.hex,hex)
  const options=campaignForcedExtenderCollapseOptions(forced,'axis',boards.extenderWork); assert.ok(options)
  assert.equal(options.destinations.includes(loaded.playable.resolveHex('B42.06')),true)
  assert.equal(options.destinations.includes(hex),false)
  assert.equal(campaignForcedExtenderCollapseOptions(forced,'soviet',boards.extenderWork),null)
  const action={type:'collapse-campaign-extender',id:forced.forcedExtenderCollapse.id,destination:'B42.06'}
  assert.throws(()=>applyCampaignTurn(forced,'soviet',action,{extenderWork:boards.extenderWork}),/Choose your own extender/)
  assert.throws(()=>applyCampaignTurn(forced,'axis',{...action,destination:'B41.06'},{extenderWork:boards.extenderWork}),/supply trace/)
  const settled=applyCampaignTurn(forced,'axis',action,{extenderWork:boards.extenderWork})
  assert.equal(settled.extenders.length,0)
  assert.equal(settled.forcedExtenderCollapse,undefined)
  const point=Object.entries(settled.counters).find(([,c])=>c.side==='axis'&&c.kind==='transport'&&c.location.kind==='map'&&c.location.hex===loaded.playable.resolveHex('B42.06')&&c.transportPoints===5)
  assert.ok(point,'the collapsed extender flips to 5 real transport points')
})

test('scenario 01 9.14d flips the extender to 5 points and opens 9.14c when no traced destination exists', async()=>{
  const loaded=await load(); const choices=dnieperOpeningChoices(loaded)
  const trucks=choices.find(c=>c.kind==='transport'&&c.definition.endsWith('tp_003')); assert.ok(trucks)
  const state=openCampaignMatch(prepareDnieperBoard(loaded),createRngState(1)).state
  const truckIds=Object.keys(state.counters).filter(id=>id.startsWith(`01-optional:${trucks.id}:`)).slice(0,5); assert.equal(truckIds.length,5)
  const hex=loaded.playable.resolveHex('B41.06')
  const counters={...state.counters}
  for(const id of truckIds) counters[id]={...counters[id],location:{kind:'map',hex}}
  const attack=loaded.setup.counters.find(c=>c.ref==='Sov 53 MC Rgt'); assert.ok(attack)
  const attackerId=Object.keys(state.counters).find(id=>state.counters[id].side==='soviet'&&state.counters[id].definition===attack.definition); assert.ok(attackerId)
  counters[attackerId]={...counters[attackerId],location:{kind:'map',hex}}
  const base={...state,counters,cursor:{first:'soviet',phasing:'axis',phase:'movement'},movementSegment:'movement'}
  const noTrace=dnieperExtenderBoard(loaded.playable,loaded.catalog.definitions,{hasTrace:()=>false})
  const converted=convertCampaignExtender(base,'axis',{type:'convert-campaign-extender',hex,kind:'truck',count:1},noTrace)
  const boards=dnieperCampaignBoards(loaded,{hasTrace:()=>false})
  const moved=boards.groundMovement?.afterMove?.(converted,'soviet',{path:[hex],
    movers:[{id:attackerId,combat:true,stepsLeft:0}],placements:[{id:attackerId,hex}]})??converted
  assert.equal(moved.forcedExtenderCollapse,undefined)
  assert.equal(moved.extenders.length,0)
  assert.equal(moved.transportCapture.owner,'axis')
  assert.equal(moved.transportCapture.hex,hex)
  assert.ok(moved.transportCapture.groups.reduce((sum,g)=>sum+g.totalPoints,0)>=5)
  assert.ok(Object.entries(moved.counters).some(([,c])=>c.side==='axis'&&c.kind==='transport'&&
    c.location.kind==='map'&&c.location.hex===hex&&c.transportPoints===5),
    'the flipped extender is a real 5-point transport at the original hex')
})