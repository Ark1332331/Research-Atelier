'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import DetailDrawer from './detail-drawer';
import type {PublicModelConfigs,PublicModelProfile} from '@/lib/model-config';

type Context={data:PublicModelConfigs|null;busy:boolean;error:string;open:()=>void;activate:(id:string|null)=>Promise<void>};
const ModelContext=createContext<Context|null>(null);
const empty={name:'',baseUrl:'',model:'',apiKey:''};
async function request(body?:Record<string,unknown>){const r=await fetch('/api/model-configs',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const result=await r.json();if(!r.ok)throw Error(result.error||'模型配置操作失败');return result;}

export function ModelSettingsProvider({children}:{children:ReactNode}){
 const [data,setData]=useState<PublicModelConfigs|null>(null),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [editing,setEditing]=useState<string|null>(null),[form,setForm]=useState(empty),[message,setMessage]=useState('');
 const channel=useRef<BroadcastChannel|null>(null),running=useRef(false),version=useRef(0);
 const refresh=useCallback(()=>{if(running.current)return Promise.resolve();const token=++version.current;return request().then(result=>{if(token!==version.current)return;setData(result);setError('');},e=>{if(token===version.current)setError(e instanceof Error?e.message:'无法加载模型配置');});},[]);
 useEffect(()=>{void refresh();const focus=()=>void refresh();window.addEventListener('focus',focus);if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('research-atelier-model-config');channel.current.onmessage=focus;}return()=>{window.removeEventListener('focus',focus);channel.current?.close();};},[refresh]);
 async function mutate(body:Record<string,unknown>){if(running.current)return false;running.current=true;version.current++;setBusy(true);setError('');setMessage('');try{setData(await request(body));channel.current?.postMessage('changed');return true;}catch(e){setError(e instanceof Error?e.message:'操作失败');return false;}finally{running.current=false;setBusy(false);}}
 async function activate(id:string|null){if(await mutate({action:'activate',id}))setMessage('已切换，下一次请求生效。');}
 function edit(profile?:PublicModelProfile){setEditing(profile?.id??null);setForm(profile?{name:profile.name,baseUrl:profile.baseUrl,model:profile.model,apiKey:''}:empty);setMessage('');setError('');}
 function open(){setVisible(true);void refresh();}
 async function remove(id:string){if(await mutate({action:'delete',id})){if(editing===id)edit();setMessage('配置已删除。');}}
 async function save(activate:boolean){if(await mutate({action:'save',...form,...(editing?{id:editing}:{}),activate})){setEditing(null);setForm(empty);setMessage(activate?'已保存并启用，下一次请求生效。':'配置已保存。');}}
 async function testConnection(){if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('');try{const result=await request({action:'test',...form,...(editing?{id:editing}:{})});setMessage(`连接成功 · ${result.elapsedMs} ms`);}catch(e){setError(e instanceof Error?e.message:'连接失败');}finally{running.current=false;setBusy(false);}}
 const selected=data?.profiles.find(p=>p.id===editing);
 return <ModelContext.Provider value={{data,busy,error,open,activate}}>{children}{visible&&<DetailDrawer title="模型配置" onClose={()=>{setVisible(false);setForm(empty);setEditing(null);}} busy={busy}>
  <div className="model-settings">
   <p className="model-settings-intro">保存不同服务的配置，随时切换。用于问答、翻译、论文导入和后台观察；正在生成的回答继续完成。</p>
   <label className="model-field">当前使用<select aria-label="当前使用" value={data?.activeId??''} disabled={busy||!data} onChange={e=>void activate(e.target.value||null)}><option value="">环境默认{data?.environment.hasKey?'':'（未配置）'} · {data?.environment.model??''}</option>{data?.profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>
   <div className="model-profile-list" aria-label="已保存模型配置">{data?.profiles.map(p=><article className="model-profile" key={p.id}><div><strong>{p.name}{data.activeId===p.id&&<small>使用中</small>}</strong><span>{p.model}</span><span>{p.baseUrl}</span></div><div className="model-profile-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>edit(p)} aria-label={`编辑 ${p.name}`}>编辑</button><button type="button" className="text-button" disabled={busy||data.activeId===p.id} title={data.activeId===p.id?'先切换到其他配置再删除':undefined} onClick={()=>void remove(p.id)} aria-label={`删除 ${p.name}`}>删除</button></div></article>)}</div>
   <form className="model-edit-form" onSubmit={e=>{e.preventDefault();void save(true);}}>
    <div className="model-form-title"><h3>{editing?'编辑配置':'新增配置'}</h3>{editing&&<button className="text-button" type="button" disabled={busy} onClick={()=>edit()}>新增另一套</button>}</div>
    <label className="model-field">配置名称<input value={form.name} required maxLength={80} disabled={busy} placeholder="例如：日常问答 / 推理模型" onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label className="model-field">Base URL<input aria-label="Base URL" value={form.baseUrl} required type="url" maxLength={1000} disabled={busy} placeholder="https://api.example.com/v1" autoCapitalize="none" spellCheck={false} onChange={e=>setForm({...form,baseUrl:e.target.value})}/><small>支持 OpenAI 兼容的 Chat Completions 接口，也可填写完整接口地址。</small></label>
    <label className="model-field">模型名称<input value={form.model} required maxLength={200} disabled={busy} placeholder="填写服务商提供的模型 ID" autoCapitalize="none" spellCheck={false} onChange={e=>setForm({...form,model:e.target.value})}/></label>
    <label className="model-field">API Key<input aria-label="API Key" value={form.apiKey} required={!selected?.hasKey} type="password" maxLength={4000} disabled={busy} autoComplete="new-password" placeholder={selected?.hasKey?'已保存，留空保留原密钥':'输入 API Key'} onChange={e=>setForm({...form,apiKey:e.target.value})}/><small>密钥保存在本机用户数据目录，不回显、不写入浏览器存储。</small></label>
    <div className="model-edit-actions"><button className="btn" type="button" disabled={busy||!form.name||!form.baseUrl||!form.model||(!form.apiKey&&!selected?.hasKey)} onClick={()=>void testConnection()}>测试连接</button><button className="btn" type="button" disabled={busy||!form.name||!form.baseUrl||!form.model||(!form.apiKey&&!selected?.hasKey)} onClick={()=>void save(false)}>仅保存</button><button className="btn btn--primary" type="submit" disabled={busy}>{busy?'处理中…':'保存并启用'}</button></div>
   </form>
   {error&&<p role="alert" className="model-error">{error}</p>}{message&&<p role="status" className="model-success">{message}</p>}
  </div>
 </DetailDrawer>}</ModelContext.Provider>;
}
export function ModelControl(){
 const context=useContext(ModelContext);if(!context)return null;
 const {data,busy,error,open,activate}=context;
 return <div className="model-control"><select aria-label="当前模型配置" title={error||'切换后从下一次请求生效'} disabled={busy||!data} value={data?.activeId??''} onChange={e=>void activate(e.target.value||null)}><option value="">{data?.environment.model??'模型…'}</option>{data?.profiles.map(p=><option value={p.id} key={p.id}>{p.name} · {p.model}</option>)}</select><button type="button" onClick={open} aria-label="打开模型配置" title={error||'管理模型配置'}>{error?'配置异常':'模型配置'}</button></div>;
}
