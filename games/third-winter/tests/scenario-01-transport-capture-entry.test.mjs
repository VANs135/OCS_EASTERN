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
import { dnieperGroundMovementBoard } from '../src/match/dnieper-ground-movement.ts'
import { dnieperTransportCaptureBoard } from '../src/match/dnieper-transport-capture.ts'

const ROOT='D:/war game/OCS各作数据库/OCS第三个冬天'
const SCENARIO='01-dnepr-battles'
const read=async(...p)=>JSON.parse((await readFile(join(ROOT,...p),'utf8')).replace(/^\uFEFF/,''))
async function load(){ const [hexes,edges,catalog,setupRaw]=await Promise.all([read('地图数据库','map_hexes.json'),read('地图数据库','map_edges.json'),loadThirdWinterV2Units(f=>read('data',f)),read('scenarios',SCENARIO,'setup.json')]); const geometry=indexTtwCampaignMap(hexes,edges); const playable=campaignMapInPlayArea(geometry,ttwCampaignPlayArea(SCENARIO)); const terrain=campaignTerrain(playable); const setup=prepareCampaignSetup(setupRaw,catalog.aliases,geometry,playable); return {map:geometry,catalog,setup,setupRaw,playable,terrain} }

test('scenario 01 real B35.17 transports auto-open 9.14c on ground entry and settle with the real board', async()=>{
  const loaded=await load()
  const base=openCampaignMatch(prepareDnieperBoard(loaded),createRngState(1)).state
  const hex=loaded.playable.resolveHex('B35.17')
  assert.ok(hex)
  const attackerRow=loaded.setup.counters.find(c=>c.ref==='Ge 302 Ers Bn'); assert.ok(attackerRow)
  const attackerId=Object.keys(base.counters).find(id=>base.counters[id].side==='axis'&&base.counters[id].definition===attackerRow.definition)
  assert.ok(attackerId)
  const sovietCombat=Object.entries(base.counters).filter(([,c])=>c.side==='soviet'&&c.location.kind==='map'&&c.location.hex===hex&&loaded.catalog.definitions.get(c.definition)?.source.faces.combat?.stats.attack!=null).map(([id])=>id)
  assert.equal(sovietCombat.length,2)
  const counters={...base.counters}; for(const id of sovietCombat) delete counters[id]
  counters[attackerId]={...counters[attackerId],location:{kind:'map',hex}}
  const state={...base,cursor:{first:'soviet',phasing:'axis',phase:'movement'},movementSegment:'movement',weather:base.opening.weather,counters,groundMovement:{moved:[],zocLocks:[]}}
  const transport=dnieperTransportCaptureBoard(loaded.playable,loaded.catalog.definitions)
  const board=dnieperGroundMovementBoard(loaded.playable,loaded.terrain,loaded.catalog.definitions,undefined,transport)
  const moved=board.afterMove?.(state,'axis',{path:[hex],movers:[{id:attackerId,combat:true,stepsLeft:0}],placements:[{id:attackerId,hex}]}) ?? state
  assert.equal(moved.counters[attackerId].location.hex,hex)
  assert.ok(moved.transportCapture,'entering with a combat unit opens the 9.14c window')
  assert.equal(moved.transportCapture.captor,'axis'); assert.equal(moved.transportCapture.owner,'soviet')
  const kinds=moved.transportCapture.groups.map(g=>g.kind); assert.deepEqual(kinds,['trucks','wagons'])
  const choices=moved.transportCapture.groups.map(group=>{
    const ids=[]; let points=0
    for(const item of group.items){ if(points>=group.capturedPoints) break; ids.push(item.id); points+=item.points }
    assert.equal(points,group.capturedPoints)
    const displacedTo=loaded.playable.neighbors(hex).find(n=>loaded.playable.availableHexes.has(n))
    return {kind:group.kind,capturedIds:ids,displacedTo}
  })
  const settled=applyCampaignTurn(moved,'soviet',{type:'resolve-campaign-transport-capture',choices},{transportCapture:transport})
  assert.equal(settled.transportCapture,undefined)
  const axis=Object.entries(settled.counters).filter(([,c])=>c.kind==='transport'&&c.side==='axis'&&c.location.kind==='map'&&c.location.hex===hex)
  const expectedCaptured=choices.reduce((sum,choice)=>sum+choice.capturedIds.length,0)
  assert.equal(axis.length, expectedCaptured, 'the real captured counters became Axis transport')
  const originalIds=moved.transportCapture.groups.flatMap(group=>group.items.map(item=>item.id))
  for(const id of originalIds) assert.equal(settled.counters[id],undefined)
  const soviet=Object.entries(settled.counters).filter(([id])=>id.startsWith('transport:soviet:'))
  assert.equal(soviet.length,originalIds.length-expectedCaptured, 'the remaining real counters were displaced')
  for(const [,c] of axis) assert.ok(c.definition.startsWith('transport:id:'))
  for(const [,c] of soviet) assert.ok((c.transportPoints??0)>=1)
  assert.throws(()=>applyCampaignTurn(moved,'axis',{type:'resolve-campaign-transport-capture',choices},{transportCapture:transport}),
    /Only the owning player/)
})



