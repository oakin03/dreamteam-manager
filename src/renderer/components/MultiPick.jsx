import { useState } from 'react';
import useDismiss from './useDismiss';

// Many values out of a list (user 2026-11-24: accounts and ratings picked together). Accounts with the
// same name prefix (Pipelne1…50) also come as one row that ticks the whole group.
export function MultiPick({ label, allText, options, value, onChange, groups = null }) {
  const [open,setOpen]=useState(false);
  const ref=useDismiss(open,()=>setOpen(false));
  const set=new Set(value);
  const toggle=v=>onChange(set.has(v)?value.filter(x=>x!==v):[...value,v]);
  const shown=!value.length?`${allText} · ${label}`:value.length===1?(options.find(o=>o.value===value[0])?.label||value[0]):`${label}: ${value.length}`;
  return <div className="multi-pick" ref={ref}><button type="button" className={`multi-pick-btn ${value.length?'on':''}`} onClick={()=>setOpen(o=>!o)}>{shown} ▾</button>
    {open&&<div className="multi-pick-menu panel"><div className="multi-pick-head"><button type="button" className="chip" onClick={()=>onChange(options.map(o=>o.value))}>{allText}</button><button type="button" className="chip" onClick={()=>onChange([])}>×</button></div>
      {groups?groups.map(g=>g.accounts?<GroupPick key={g.key} g={g} set={set} value={value} onChange={onChange}/>:<label key={g.key}><input type="checkbox" checked={set.has(g.account.id)} onChange={()=>toggle(g.account.id)}/>{g.account.name}</label>)
        :options.map(o=><label key={o.value}><input type="checkbox" checked={set.has(o.value)} onChange={()=>toggle(o.value)}/>{o.label}</label>)}</div>}</div>;
}
function GroupPick({ g, set, value, onChange }) {
  const [open,setOpen]=useState(false);
  const ids=g.accounts.map(a=>a.id); const on=ids.filter(id=>set.has(id)).length;
  return <div className="multi-pick-group"><label><input type="checkbox" checked={on===ids.length} ref={el=>{if(el)el.indeterminate=on>0&&on<ids.length}} onChange={()=>onChange(on===ids.length?value.filter(v=>!ids.includes(v)):[...new Set([...value,...ids])])}/><b>{g.label}</b> <small className="muted-text">{on}/{ids.length}</small></label><button type="button" className="grp-arrow-btn" onClick={()=>setOpen(o=>!o)}>{open?'▾':'▸'}</button>
    {open&&<div className="multi-pick-sub">{g.accounts.map(a=><label key={a.id}><input type="checkbox" checked={set.has(a.id)} onChange={()=>onChange(set.has(a.id)?value.filter(v=>v!==a.id):[...value,a.id])}/>{a.name}</label>)}</div>}</div>;
}
