"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
interface Summary {collecting:boolean;workerAlive:boolean;queued:number;pending:number;total:number}
export default function ObservationIndicator(){const [state,setState]=useState<Summary|null>(null),[error,setError]=useState(false);
 useEffect(()=>{let gone=false;const refresh=async()=>{if(document.visibilityState==="hidden")return;try{const r=await fetch("/api/learning/observations?summary=1");if(!r.ok)throw Error();const d=await r.json();if(!gone){setState(d);setError(false);}}catch{if(!gone)setError(true);}};void refresh();const timer=setInterval(()=>void refresh(),6000);return()=>{gone=true;clearInterval(timer);};},[]);
 return <Link href="/learning#observations" className="observation-indicator" title="查看真实观察记录和待采纳改法">{error?"观察记录不可用":!state?"检查观察状态…":!state.collecting?"观察已暂停":!state.workerAlive?"后台观察尚未运行":state.queued?`观察中 · ${state.queued} 条待检查`:`观察已开启 · ${state.total} 条记录`}{state?.pending?` · ${state.pending} 条待采纳`:""}</Link>;
}
