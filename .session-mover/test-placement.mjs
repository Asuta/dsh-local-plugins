import fs from 'node:fs/promises'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import {placementBefore,captureOrder,restoreBefore} from '../session-mover/placement.js'
let count=0
function eq(actual,expected,label){assert.deepEqual(actual,expected,label);count++}
const ids=['p1','n1','p2','n2','n3'],pins=['p1','p2','m-pin']
eq(placementBefore(ids,pins,'m'), 'n1','normal header')
eq(placementBefore(ids,pins,'m-pin'), 'p1','pinned header')
for(const moving of ['m','m-pin'])for(const anchor of ids)for(const edge of ['before','after']){const same=pins.includes(moving)===pins.includes(anchor), part=ids.filter(id=>pins.includes(id)===pins.includes(moving));eq(placementBefore(ids,pins,moving,{anchorSessionId:anchor,edge}),same?(edge==='before'?anchor:part[part.indexOf(anchor)+1]):part[0],`${moving}/${anchor}/${edge}`)}
eq(placementBefore(ids,pins,'m',{edge:'end'}),undefined,'explicit end')
eq(placementBefore([],pins,'m'),undefined,'empty group')
assert.throws(()=>placementBefore(ids,pins,'m',{anchorSessionId:'gone',edge:'before'}),{code:'STALE_POSITION'});count++
const order=captureOrder(['a','m','b','c'],'m')
eq(restoreBefore(['m','a','b','c'],'m',order),'b','undo raw successor')
eq(restoreBefore(['m','a','c'],'m',order),'c','undo deleted immediate successor')
eq(restoreBefore(['m','x','a'],'m',order),undefined,'undo previous fallback')
eq(ids,['p1','n1','p2','n2','n3'],'pure no mutation')
const text=await fs.readFile(new URL('../session-mover/client.js',import.meta.url),'utf8')
const factoryStart=text.indexOf('  factory(require) {')+'  factory(require) {'.length
const factoryEnd=text.lastIndexOf('    return {\n      inject:')
assert(factoryStart>0&&factoryEnd>factoryStart)
const source=text.slice(factoryStart,factoryEnd)+`
 globalThis.api={accountOrders,ownPartition,dropTarget,spliceBefore,restoreLocalBefore,applyLocalPlacement,nativeOrderContext,orderSignature,waitForMembership,Mover,setContext(value){clientContext=value}};`
let currentView={orderBy:'manual',sessionOrderByAccount:{source:['m','s'],target:['p1','p2','n1','n2','n3']},archivedFilter:'default'}
const snapshot={phase:'ready',state:'idle',items:[{workspaceId:'source',sessionIds:['m','s']},{workspaceId:'target',sessionIds:['p1','n1','p2','n2','n3']}],pinnedSessionIds:pins,archivedSessionIds:[]}
const byId=Object.fromEntries(['m','s',...ids].map((id,i)=>[id,{id,updatedAt:100-i,retainedBy:{},blank:false,origin:'user'}]))
const list={phase:'ready',ids:Object.keys(byId),byId}
const actions={setSessionOrder(key,order,initial){currentView={...currentView,orderBy:'manual',sessionOrderByAccount:{...currentView.sessionOrderByAccount,...initial,[key]:order}}},setOrderBy(mode){currentView={...currentView,orderBy:mode,sessionOrderByAccount:mode==='updated'?{}:currentView.sessionOrderByAccount}}}
const store={actions,getSnapshot:()=>currentView,subscribe:()=>()=>{}}
const rawUi={view:actions},proxyUi={[Symbol.for('cordis.original')]:rawUi,view:{}}
const ctx={get(key){return key==='uiWorkspace'?proxyUi:key==='workspaces'?{list:{getSnapshot:()=>snapshot,subscribe:()=>()=>{}}}:key==='sessions'?{list:{getSnapshot:()=>list}}:null},slots:{entries:()=>[{store:{spec:{persist:'dsh.workspace.view.v5'},create:()=>store}}]}}
const React={createElement:(...args)=>args,Fragment:'fragment',useMemo:f=>f(),useState:initial=>[initial,()=>{}],useRef:value=>({current:value}),useCallback:f=>f,useEffect:()=>{}}
const sandbox={require:()=>React,window:{setTimeout,clearTimeout},navigator:{language:'zh-CN'},console,structuredClone,Set,Map,Symbol};vm.createContext(sandbox);vm.runInContext(source,sandbox);const a=sandbox.api;a.setContext(ctx)
const context=a.nativeOrderContext();eq(context.view.orderBy,'manual','raw native store identity accepted')
eq(Array.from(a.ownPartition(context,'target','m')),['n1','n2','n3'],'full own partition includes hidden overflow')
function rows(keys){const nodes=keys.map((key,i)=>({key,getAttribute:()=>key,getBoundingClientRect:()=>({top:i*20,bottom:(i+1)*20,height:20,left:0,width:200}),closest(sel){return sel==='[role="tree"]'?tree:this}}));const tree={querySelectorAll:()=>nodes};return nodes}
let r=rows(['workspace:target','session:p1','session:p2','session:n1','session:n2','session:n3'])
eq(a.dropTarget(r[0],0,'m',context).before,'n1','header below pins')
eq(a.dropTarget(r[1],22,'m',context).before,'n1','normal on pinned goes own head')
eq(a.dropTarget(r[4],82,'m',context).before,'n2','top half before')
eq(a.dropTarget(r[4],98,'m',context).before,'n3','bottom half after')
eq(a.dropTarget(r[5],118,'m',context).position.edge,'end','last row own tail')
r=rows(['workspace:target','session:p1','session:p2','session:n1','overflow:target'])
eq(a.dropTarget(r[3],78,'m',context).before,'n2','next hidden member exact boundary')
eq(a.dropTarget(r[4],90,'m',context),null,'overflow ambiguous drop rejected')
r=rows(['workspace:target','session:p1','overflow:target']);eq(a.dropTarget(r[0],0,'m',context),null,'wholly hidden partition no false line')
eq(Array.from(a.spliceBefore(['a','b','c'],'m','b')),['a','m','b','c'],'splice preserves unrelated')
eq(a.restoreLocalBefore(['a','c'],'m',['a','m','b','c']),'c','local undo uses surviving successor')
let latest={...context,orders:{...context.orders,source:['s'],target:['n3','n2','n1','p1','p2']}}
a.applyLocalPlacement(latest,'m','source','target','n2');eq(Array.from(currentView.sessionOrderByAccount.target),['n3','m','n2','n1','p1','p2'],'rebase preserves fresh user ordering')
eq(a.orderSignature({z:['m','b'],a:['a']},'m'),a.orderSignature({a:['a'],z:['b']},'m'),'undo signature ignores only moving item')
const updated=a.accountOrders(snapshot,list,{orderBy:'updated',sessionOrderByAccount:{}});eq(Array.from(updated.target),['p1','n1','p2','n2','n3'],'native recent ordering')
// Provisional New Session remains first without becoming a drop anchor.
list.byId.blank={id:'blank',blank:true,retainedBy:{mainView:1},updatedAt:0};snapshot.items[1].sessionIds.push('blank');list.ids.push('blank');const withBlank=a.accountOrders(snapshot,list,{orderBy:'updated',sessionOrderByAccount:{}});eq(withBlank.target[0],'blank','native blank placeholder first')
eq(a.Mover({t:undefined}),null,'render without active notice')
console.log(JSON.stringify({ok:true,assertions:count,coverage:['normal/pinned header','same/opposite partition before/after','tail and empty group','stale anchor','raw/local undo neighbors','native store proxy identity','full hidden orders','overflow refusal','fresh unrelated ordering','updated/manual projections','provisional blank']},null,2))
