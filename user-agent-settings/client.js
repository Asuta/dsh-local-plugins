window.__ModuleLoader__.load({
  id: '@local/user-agent-settings',
  factory(require) {
    const React = require('react'), h = React.createElement
    const NS = 'userAgentSettings'
    const zh = { title:'Agent 全局设置',intro:'适用于所有工作区的主 Agent 和子 Agent；项目和角色自身的指令仍然保留。',instructions:'全局 Agent 文件',fileHelp:'使用 DSH 原生全局 AGENTS.md，不重复注入提示词。保存后从下一次请求读取；不会中断正在运行的回复。',notCreated:'文件尚未创建，首次保存时创建。',save:'保存',saving:'保存中…',saved:'已保存',reload:'重新读取',discard:'有未保存的修改，确定丢弃并重新读取吗？',loading:'正在加载设置…',error:'操作失败：',conflict:'内容已在其它位置改变，请先重新读取再保存。',compression:'上下文压缩模型',compressionHelp:'仅影响自动、手动及选区压缩，不改变正常对话模型。默认跟随每条会话的模型。模型不可用时明确报错，不静默切换。',follow:'跟随当前会话模型',choose:'指定模型',provider:'提供商',model:'模型',saveCompression:'保存压缩设置',modelPlaceholder:'选择模型或输入精确模型 ID',capability:'适配状态',refresh:'刷新前端',refreshHelp:'重新加载当前界面，相当于 Ctrl+R，不重启 DSH 后端。其它页面中尚未发送或保存的内容可能丢失。',refreshButton:'刷新当前界面',refreshConfirm:'刷新会重新加载当前界面，未保存的编辑或草稿可能丢失。是否继续？',refreshDirty:'本页还有未保存的设置。刷新后这些修改会丢失，是否继续？',limit:'最多 128 KiB；此文件不是最高优先级指令，不覆盖系统或项目约束。',statusReady:'已接入原生压缩流程',statusLimited:'部分压缩引擎不兼容，请查看状态',noProviders:'没有可用的模型提供商，请先在模型设置中配置。',retry:'重试' }
    const en = { title:'Global Agent Settings',intro:'Applies to main agents and subagents in every workspace, alongside project and role instructions.',instructions:'Global Agent file',fileHelp:'Edits the native global AGENTS.md without duplicate prompt injection. Changes apply from the next request; running replies are not interrupted.',notCreated:'The file does not exist yet. Saving creates it.',save:'Save',saving:'Saving…',saved:'Saved',reload:'Reload from disk',discard:'Discard unsaved edits and reload from disk?',loading:'Loading settings…',error:'Operation failed: ',conflict:'The content changed elsewhere. Reload before saving.',compression:'Context compression model',compressionHelp:'Applies only to automatic, manual and region compression, not normal replies. By default, follows each conversation model. Unavailable models fail explicitly.',follow:'Follow conversation model',choose:'Choose a model',provider:'Provider',model:'Model',saveCompression:'Save compression setting',modelPlaceholder:'Choose or enter the exact model ID',capability:'Adapter status',refresh:'Refresh frontend',refreshHelp:'Reloads the current interface like Ctrl+R without restarting the DSH backend. Unsent or unsaved content elsewhere may be lost.',refreshButton:'Reload this interface',refreshConfirm:'Reload this interface? Unsaved edits or drafts may be lost.',refreshDirty:'This page has unsaved settings. Reloading will discard them. Continue?',limit:'Up to 128 KiB. Global instructions do not override system or project constraints.',statusReady:'Connected to native compression',statusLimited:'Some compression engines are unsupported; inspect status',noProviders:'No model providers are available. Configure one in model settings first.',retry:'Retry' }
    async function request(body, signal) {
      const response = await fetch('/__user-agent-settings/operation',{method:'POST',headers:{'content-type':'application/json','x-user-agent-settings':'1'},body:JSON.stringify(body),signal})
      const result = await response.json()
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || 'Request failed'), { code: result.code })
      return result
    }
    function Page({ t }) {
      const tr = React.useCallback(key => { const fallback = String(navigator.language).toLowerCase().startsWith('zh') ? zh : en; const value = t?.(key); return value && value !== key ? value : fallback[key] ?? key },[t])
      const [state,setState] = React.useState(null), [providers,setProviders] = React.useState([]),[text,setText] = React.useState(''),[mode,setMode] = React.useState('follow'),[provider,setProvider] = React.useState(''),[model,setModel] = React.useState(''),[busy,setBusy] = React.useState(''),[notice,setNotice] = React.useState(null)
      const original = state?.compaction
      const instructionDirty = !!state && text !== state.instructions.text
      const selectionDirty = !!state && JSON.stringify(mode==='follow'?null:{provider,model}) !== JSON.stringify(original)
      const dirty = instructionDirty || selectionDirty
      const showError = error => setNotice({error:true,text:error.code==='CONFLICT'?tr('conflict'):tr('error')+error.message})
      const load = React.useCallback(async signal => {
        setBusy('load');setNotice(null)
        try {
          const result = await request({action:'read'},signal); if(signal?.aborted)return
          setState(result);setText(result.instructions.text);setMode(result.compaction?'choose':'follow');setProvider(result.compaction?.provider??'');setModel(result.compaction?.model??'')
          const catalog=await request({action:'models'},signal);if(!signal?.aborted)setProviders(catalog.providers)
        } catch(error){if(error.name!=='AbortError')showError(error)}
        finally { if(!signal?.aborted)setBusy('') }
      },[tr])
      React.useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[load])
      React.useEffect(()=>{if(!dirty)return;const warn=event=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
      async function saveInstructions(){setBusy('instructions');setNotice(null);try{const result=await request({action:'save_instructions',text,revision:state.instructions.revision});setState(previous=>({...previous,instructions:result.instructions}));setNotice({text:tr('saved')})}catch(error){showError(error)}finally{setBusy('')}}
      async function saveCompression(){setBusy('compression');setNotice(null);try{const result=await request({action:'save_compaction',compaction:mode==='follow'?null:{provider,model},revision:state.revision});setState(previous=>({...previous,compaction:result.compaction,revision:result.revision,status:result.status}));setNotice({text:tr('saved')})}catch(error){showError(error)}finally{setBusy('')}}
      const models=providers.find(item=>item.id===provider)?.models??[]
      const button=(label,onClick,disabled=false,primary=false)=>h('button',{type:'button',className:'uas-button'+(primary?' uas-primary':''),onClick,disabled:!!busy||disabled},label)
      const card=(title,...children)=>h('section',{className:'uas-card'},h('h3',null,title),...children)
      return h('div',{className:'uas-page','data-plugin':'@local/user-agent-settings'},h('style',null,CSS),h('h2',null,tr('title')),h('p',{className:'uas-muted'},tr('intro')),
        notice?h('div',{role:notice.error?'alert':'status',className:'uas-notice'+(notice.error?' uas-error':'')},notice.text):null,
        !state?h('div',null,tr('loading'),!busy?button(tr('retry'),()=>load()):null):h(React.Fragment,null,
          card(tr('instructions'),h('p',{className:'uas-muted'},tr('fileHelp')),h('code',{className:'uas-path'},state.instructions.path),!state.instructions.exists?h('p',{className:'uas-muted'},tr('notCreated')):null,h('textarea',{'aria-label':tr('instructions'),className:'uas-editor',value:text,onChange:event=>setText(event.target.value),spellCheck:false,disabled:!!busy}),h('p',{className:'uas-muted'},tr('limit')),h('div',{className:'uas-actions'},button(busy==='instructions'?tr('saving'):tr('save'),saveInstructions,!instructionDirty,true),button(tr('reload'),()=>{if(!dirty||window.confirm(tr('discard')))void load()}))),
          card(tr('compression'),h('p',{className:'uas-muted'},tr('compressionHelp')),h('label',{className:'uas-field'},h('span',null,tr('compression')),h('select',{value:mode,onChange:event=>setMode(event.target.value),disabled:!!busy},h('option',{value:'follow'},tr('follow')),h('option',{value:'choose'},tr('choose')))),mode==='choose'?h(React.Fragment,null,h('label',{className:'uas-field'},h('span',null,tr('provider')),h('select',{value:provider,onChange:event=>{setProvider(event.target.value);setModel('')},disabled:!!busy},h('option',{value:''},'—'),...providers.map(item=>h('option',{key:item.id,value:item.id},item.name||item.id)))),h('label',{className:'uas-field'},h('span',null,tr('model')),h('input',{value:model,list:'uas-models',placeholder:tr('modelPlaceholder'),onChange:event=>setModel(event.target.value),disabled:!!busy})),h('datalist',{id:'uas-models'},...models.map(item=>h('option',{key:item.id,value:item.id},item.name||item.id))),providers.length===0?h('p',{className:'uas-muted'},tr('noProviders')):null):null,h('div',{className:'uas-actions'},button(busy==='compression'?tr('saving'):tr('saveCompression'),saveCompression,!selectionDirty||(mode==='choose'&&(!provider||!model)),true)),state.status?h('details',{className:'uas-diagnostics'},h('summary',null,tr('capability')),h('pre',null,JSON.stringify(state.status,null,2))):null),
          card(tr('refresh'),h('p',{className:'uas-muted'},tr('refreshHelp')),button(tr('refreshButton'),()=>{if(window.confirm(tr(dirty?'refreshDirty':'refreshConfirm')))window.location.reload()}))
        ))
    }
    const CSS = `
      .uas-page { max-width: 880px; padding: 28px 32px 48px; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family),system-ui,sans-serif; }
      .uas-page h2 { margin: 0 0 10px; font-size: 20px; font-weight: 600; } .uas-page h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
      .uas-muted { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.65; margin: 8px 0 14px; }
      .uas-card { padding: 22px 0 26px; border-bottom: 1px solid var(--dsw-alias-border-l1); } .uas-card:last-child { border: none; }
      .uas-path { display:block; overflow-wrap:anywhere; font-size:12px; margin:12px 0; color:var(--dsw-alias-label-secondary); }
      .uas-editor { box-sizing: border-box; display:block; width:100%; min-height:260px; resize:vertical; padding:14px; line-height:1.6; font-family:ui-monospace,Consolas,monospace; font-size:13px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:10px; }
      .uas-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
      .uas-button { border:1px solid var(--dsw-alias-border-l1); border-radius:8px; padding:8px 14px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; cursor:pointer; }
      .uas-button:hover { background:var(--dsw-alias-interactive-bg-hover); } .uas-button:disabled { opacity:.5; cursor:default; } .uas-primary { color:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); }
      .uas-field { display:grid; grid-template-columns:130px minmax(0,1fr); align-items:center; gap:16px; margin:14px 0; font-size:13px; }
      .uas-field input,.uas-field select { box-sizing:border-box; width:100%; padding:9px 11px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; }
      .uas-notice { padding:10px 14px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; font-size:13px; } .uas-error { color:var(--dsw-alias-state-error-primary); }
      .uas-diagnostics { margin-top:14px; font-size:12px; color:var(--dsw-alias-label-secondary); } .uas-diagnostics pre { white-space:pre-wrap; overflow-wrap:anywhere; }
      .uas-page button:focus-visible,.uas-page input:focus-visible,.uas-page select:focus-visible,.uas-page textarea:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      @media(max-width:600px){.uas-page{padding:20px 16px}.uas-field{grid-template-columns:1fr;gap:7px}}
    `
    return {inject:['slots','locale'],apply(ctx){
      ctx.effect(()=>ctx.locale.register(NS,{zh,en}),'user-agent-settings: translations')
      ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'user-agent-settings',order:45,label:()=>ctx.locale.bind(NS)('title'),locale:NS},Page)),'user-agent-settings: settings page')
    }}
  },
})
