const GRADES=['N','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+','S-','S','S+'];
const NUMERIC=new Set(['salary','base','value','valueChange','price']);
const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});

function numeric(value){
  if(value==null || value==='')return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  let raw=String(value).trim().replace(/\s/g,'').replace(/[^0-9.,-]/g,'');
  if(/^-?\d{1,3}(?:[.,]\d{3})+$/.test(raw))raw=raw.replace(/[.,]/g,'');
  else raw=raw.replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  const number=Number(raw);
  return raw && Number.isFinite(number)?number:null;
}

function valueFor(row,key){
  const raw=row?.[key];
  if(key==='grade'){
    const rank=GRADES.indexOf(String(raw||'').trim().toUpperCase());
    return rank<0?null:rank;
  }
  if(NUMERIC.has(key))return numeric(raw);
  return raw==null || String(raw).trim()===''?null:String(raw).trim();
}

function searchTerms(query){
  return String(query||'').split(',').map(term=>term.trim().toLowerCase()).filter(Boolean);
}

export function filterTradingRows(rows,filters={}){
  const nameTerms=searchTerms(filters.name);
  const sellerTerms=searchTerms(filters.seller);
  const minGrade=filters.gradeMin?GRADES.indexOf(String(filters.gradeMin).trim().toUpperCase()):null;
  const maxGrade=filters.gradeMax?GRADES.indexOf(String(filters.gradeMax).trim().toUpperCase()):null;
  const salaryMin=numeric(filters.salaryMin),salaryMax=numeric(filters.salaryMax);
  const priceMin=numeric(filters.priceMin),priceMax=numeric(filters.priceMax);
  const matches=(value,terms)=>!terms.length || terms.some(term=>String(value||'').toLowerCase().includes(term));
  return (rows||[]).filter(row=>{
    if(!row || !matches(row.name,nameTerms) || !matches(row.seller,sellerTerms))return false;
    if(filters.position && filters.position!=='All' &&
       !String(row.position||'').split('/').some(position=>position.trim()===filters.position))return false;
    if(filters.currency && filters.currency!=='All' && row.currency!==filters.currency)return false;
    const grade=valueFor(row,'grade');
    if((minGrade!==null || maxGrade!==null) && (grade===null ||
       minGrade!==null && (minGrade<0 || grade<minGrade) ||
       maxGrade!==null && (maxGrade<0 || grade>maxGrade)))return false;
    const salary=valueFor(row,'salary');
    if((salaryMin!==null || salaryMax!==null) && (salary===null ||
       salaryMin!==null && salary<salaryMin ||
       salaryMax!==null && (filters.salaryMaxExclusive?salary>=salaryMax:salary>salaryMax)))return false;
    const price=valueFor(row,'price');
    if((priceMin!==null || priceMax!==null) && (price===null ||
       priceMin!==null && price<priceMin || priceMax!==null && price>priceMax))return false;
    return true;
  });
}

export function hasTradingSortData(rows,key){
  return (rows||[]).some(row=>valueFor(row,key)!=null);
}

export function sortTradingRows(rows,{key='price',dir='asc'}={}){
  const direction=dir==='desc'?-1:1;
  return [...(rows||[])].map((row,index)=>({row,index,value:valueFor(row,key)}))
    .sort((a,b)=>{
      if(a.value==null || b.value==null){
        if(a.value==null && b.value==null)return a.index-b.index;
        return a.value==null?1:-1;
      }
      const comparison=typeof a.value==='number'&&typeof b.value==='number'
        ?a.value-b.value:collator.compare(String(a.value),String(b.value));
      return comparison?direction*comparison:a.index-b.index;
    }).map(entry=>entry.row);
}
