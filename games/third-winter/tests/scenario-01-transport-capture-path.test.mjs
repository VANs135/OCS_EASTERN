import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRngState } from '@ocs-eastern/series/rng'
import { indexTtwCampaignMap } from '../src/import/campaign-map-index.ts'
import { prepareCampaignSetup } from '../src/import/campaign-setup.ts'
import { loadThirdWinterV2Units } from '../src/import/unit-v2.ts'
import { campaignTerrain } from '../src/import/campaign-terrain.ts'
import { campaignMapInPlayArea, ttwCampaignPlayArea } from '../src/ttw/campaign/play-area.ts'
import { prepareDnieperBoard } from '../src/match/dnieper-opening.ts'
import { applyCampaignTurn, openCampaignMatch } from '../src/match/campaign-match.ts'
import { dnieperCampaignBoards } from '../src/match/dnieper-campaign-boards.ts'

const ROOT='D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO='01-dnepr-battles'
const read=async(...p)=>JSON.parse((await readFile(join(ROOT,...p),'utf8')).replace(/^\uFEFF/,''))
async function load(){ const [hexes,edges,catalog,setupRaw]=await Promise.all([read('地图数据库','map_hexes.json'),read('地图数据库','map_edges.json'),loadThirdWinterV2Units(f=>read('data',f)),read('scenarios',SCENARIO,'setup.json')]); const geometry=indexTtwCampaignMap(hexes,edges); const playable=campaignMapInPlayArea(geometry,ttwCampaignPlayArea(SCENARIO)); const terrain=campaignTerrain(playable); const setup=prepareCampaignSetup(setupRaw,catalog.aliases,geometry,playable); return {map:geometry,catalog,setup,setupRaw,playable,terrain} }

test('scenario 01 9.14c queues captures along the whole move path in entry order', async()=>{
  const loaded=await load()
  const base=openCampaignMatch(prepareDnieperBoard(loaded),createRngState(1)).state
  const first=loaded.playable.resolveHex('B35.17'); const second=loaded.playable.resolveHex('B35.18')
  assert.ok(first&&second&&loaded.playable.neighbors(first).includes(second))
  const attackerRow=loaded.setup.counters.find(c=>c.ref==='Ge 302 Ers Bn'); assert.ok(attackerRow)
  const attackerId=Object.keys(base.counters).find(id=>base.counters[id].side==='axis'&&base.counters[id].definition===attackerRow.definition)
  const truckIds=Object.keys(base.counters).filter(id=>base.counters[id].side==='soviet'&&base.counters[id].kind==='transport'&&base.counters[id].definition.endsWith('tp_013')).slice(0,2)
  const wagonIds=Object.keys(base.counters).filter(id=>base.counters[id].side==='soviet'&&base.counters[id].kind==='transport'&&base.counters[id].definition.endsWith('tp_011')).slice(0,1)
  assert.equal(truckIds.length,2); assert.equal(wagonIds.length,1)
  const counters={...base.counters}
  counters[attackerId]={...counters[attackerId],location:{kind:'map',hex:second}}
  for(const id of truckIds) counters[id]={...counters[id],location:{kind:'map',hex:first}}
  for(const id of wagonIds) counters[id]={...counters[id],location:{kind:'map',hex:second}}
  const state={...base,counters,cursor:{first:'soviet',phasing:'axis',phase:'movement'},movementSegment:'movement',weather:base.opening.weather}
  const boards=dnieperCampaignBoards(loaded,{hasTrace:()=>true})
  const moved=boards.groundMovement?.afterMove?.(state,'axis',{path:[first,second],movers:[{id:attackerId,combat:true,stepsLeft:0}],placements:[{id:attackerId,hex:second}]})??state
  assert.equal(moved.transportCapture.hex,first)
  assert.equal(moved.transportCaptureQueue.length,1)
  assert.equal(moved.transportCaptureQueue[0].hex,second)
  const choose=(capture)=>capture.groups.map(group=>{
    const ids=[]; let points=0
    for(const item of group.items){ if(points>=group.capturedPoints) break; ids.push(item.id); points+=item.points }
    assert.equal(points,group.capturedPoints)
    return {kind:group.kind,capturedIds:ids,displacedTo:loaded.playable.neighbors(capture.hex).find(n=>loaded.playable.availableHexes.has(n))}
  })
  const firstSettled=applyCampaignTurn(moved,'soviet',{type:'resolve-campaign-transport-capture',choices:choose(moved.transportCapture)},{transportCapture:boards.transportCapture})
  assert.equal(firstSettled.transportCapture.hex,second)
  assert.equal(firstSettled.transportCaptureQueue,undefined)
  const secondSettled=applyCampaignTurn(firstSettled,'soviet',{type:'resolve-campaign-transport-capture',choices:choose(firstSettled.transportCapture)},{transportCapture:boards.transportCapture})
  assert.equal(secondSettled.transportCapture,undefined)
})
