import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createSettingsCore,MAX_INSTRUCTION_BYTES,homePath} from '../user-agent-settings/core.js'
const home=path.resolve('.user-agent-settings','fixtures',randomUUID());await fs.mkdir(home,{recursive:true})
let validated=[],refreshed=0,failValidation=false
const llm={listProviders:()=>[{id:'mock',name:'Mock'}],listModels:async()=>[{id:'summary',name:'Summary'}]}
const adapter={async validate(next){if(failValidation)throw new Error('Model unavailable');validated.push(next)},refresh(){refreshed++},status:()=>({mock:true})}
const core=createSettingsCore({home,llm,adapter});let count=0
function eq(a,b){assert.deepEqual(a,b);count++}
await core.load();let state=await core.snapshot();eq(state.instructions.exists,false);eq(state.compaction,null)
const saved=await core.saveInstructions({text:'# 全局指令\n保持简洁。\n',revision:state.instructions.revision});eq(saved.text,'# 全局指令\n保持简洁。\n');eq(saved.exists,true)
await assert.rejects(core.saveInstructions({text:'stale',revision:state.instructions.revision}),{code:'CONFLICT'});count++
const again=await core.saveInstructions({text:saved.text,revision:saved.revision});eq(again.revision,saved.revision)
await assert.rejects(core.saveInstructions({text:'字'.repeat(MAX_INSTRUCTION_BYTES),revision:saved.revision}),{code:'TOO_LARGE'});count++
await fs.writeFile(saved.path,'external');await assert.rejects(core.saveInstructions({text:'overwrite',revision:saved.revision}),{code:'CONFLICT'});count++
state=await core.snapshot();let selection=await core.saveCompaction({compaction:{provider:'mock',model:'summary'},revision:state.revision});eq(core.getSelection(),{provider:'mock',model:'summary'});eq(refreshed,1);eq(validated.length,1)
const cold=createSettingsCore({home,llm,adapter});await cold.load();eq(cold.getSelection(),{provider:'mock',model:'summary'})
await assert.rejects(core.saveCompaction({compaction:null,revision:state.revision}),{code:'CONFLICT'});count++
failValidation=true;await assert.rejects(core.saveCompaction({compaction:{provider:'mock',model:'bad'},revision:selection.revision}),/unavailable/);count++;eq(core.getSelection(),{provider:'mock',model:'summary'});failValidation=false
selection=await core.saveCompaction({compaction:null,revision:selection.revision});eq(core.getSelection(),null);eq(refreshed,2)
await assert.rejects(core.saveCompaction({compaction:{provider:'',model:'x'},revision:selection.revision}),{code:'BAD_SELECTION'});count++
eq((await core.models())[0].models[0].id,'summary')
const current=await core.instructions();const results=await Promise.allSettled([core.saveInstructions({text:'first',revision:current.revision}),core.saveInstructions({text:'second',revision:current.revision})]);eq(results.map(x=>x.status),['fulfilled','rejected']);eq(results[1].reason.code,'CONFLICT')
eq(homePath({DSH_HOME:'   '}),homePath({}));
console.log(JSON.stringify({ok:true,assertions:count,fixture:home,realUserSettingsTouched:false},null,2))
