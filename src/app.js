import Database from '@tauri-apps/plugin-sql';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

let db;
let data=[];
let expenses=[];
let incomes=[];
let edit=null;
let mode='tournament';
let dashYear='all';
const $=x=>document.getElementById(x);
const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const newId=()=>crypto.randomUUID();
const expenseTotal=t=>['registration','travel','food','accommodation','other'].reduce((s,k)=>s+Number(t[k]||0),0);
const net=t=>Number(t.prize||0)-expenseTotal(t);
function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function cat(t){return t.custom_category&&t.rating_category==='Other / Custom'?t.custom_category:t.rating_category||'Open'}
async function init(){
  db=await Database.load('sqlite:chess_ledger.db');
  await db.execute(`CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY,name TEXT NOT NULL,date TEXT NOT NULL,location TEXT,organizer TEXT,tournament_type TEXT,rating_category TEXT,custom_category TEXT,format TEXT,participants INTEGER,rounds INTEGER,time_control TEXT,rating INTEGER,position INTEGER,score TEXT,performance INTEGER,prize REAL DEFAULT 0,registration REAL DEFAULT 0,travel REAL DEFAULT 0,food REAL DEFAULT 0,accommodation REAL DEFAULT 0,other REAL DEFAULT 0,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  try{await db.execute(`ALTER TABLE tournaments ADD COLUMN mode TEXT DEFAULT 'Offline'`)}catch(e){if(!String(e).toLowerCase().includes('duplicate column'))throw e}

  await db.execute(`CREATE TABLE IF NOT EXISTS chess_expenses (id TEXT PRIMARY KEY,date TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,amount REAL NOT NULL,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS chess_income (id TEXT PRIMARY KEY,date TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,amount REAL NOT NULL,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  await load();
}
async function load(){data=await db.select('SELECT * FROM tournaments ORDER BY date DESC, created_at DESC');expenses=await db.select('SELECT * FROM chess_expenses ORDER BY date DESC, created_at DESC');incomes=await db.select('SELECT * FROM chess_income ORDER BY date DESC, created_at DESC');buildPerformanceYearFilter();render()}
function yearOf(date){return String(date||'').slice(0,4)}
function escText(x){return esc(x)}
function buildYearFilter(){
  const years=new Set();
  data.forEach(t=>years.add(yearOf(t.date)));
  expenses.forEach(e=>years.add(yearOf(e.date)));
  incomes.forEach(e=>years.add(yearOf(e.date)));
  const yearsArr=[...years].filter(Boolean).sort((a,b)=>b.localeCompare(a));
  const sel=$('dashYear'); if(!sel)return;
  const current=sel.value||dashYear||'all';
  sel.innerHTML='<option value="all">All Years</option>'+yearsArr.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');
  sel.value=yearsArr.includes(current)?current:'all'; dashYear=sel.value;
}
function filteredDash(){
  if(dashYear==='all') return {ts:data,es:expenses,is:incomes};
  return {ts:data.filter(t=>yearOf(t.date)===dashYear),es:expenses.filter(e=>yearOf(e.date)===dashYear),is:incomes.filter(e=>yearOf(e.date)===dashYear)};
}
function renderBars(id, items, empty='No data'){
  const el=$(id); if(!el)return;
  if(!items.length){el.innerHTML=`<div class="chart-empty">${empty}</div>`;return;}
  const max=Math.max(...items.map(x=>x.value),1);
  el.innerHTML=items.map(x=>`<div class="bar-row"><div class="bar-label" title="${escText(x.label)}">${escText(x.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,(x.value/max)*100)}%"></div></div><div class="bar-value">${money(x.value)}</div></div>`).join('');
}
function renderPerformanceTrend(items){
  const el=$('performanceTrend');
  if(!el)return;

  if(!items.length){
    el.innerHTML='<div class="chart-empty">No performance data</div>';
    return;
  }

  const W=760,H=280,left=55,right=20,top=30,bottom=60;
  const plotW=W-left-right,plotH=H-top-bottom;
  const xStep=items.length===1?0:plotW/(items.length-1);

  const grid=[];
  for(let i=0;i<=5;i++){
    const value=i*20;
    const y=top+plotH-(value/100)*plotH;
    grid.push(
      `<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" class="gridline"/>`+
      `<text x="${left-10}" y="${y+4}" text-anchor="end" class="axis-text">${value}</text>`
    );
  }

  const points=items.map((item,i)=>{
    const x=items.length===1?left+plotW/2:left+i*xStep;
    const value=Math.max(0,Math.min(100,Number(item.value)||0));
    const y=top+plotH-(value/100)*plotH;
    return {x,y,value,item};
  });

  const line=points.map((p,i)=>
    `${i?'L':'M'} ${p.x} ${p.y}`
  ).join(' ');

  const marks=points.map(p=>{
    const shortName=String(p.item.label||'').length>18
      ?String(p.item.label).slice(0,18)+'…'
      :String(p.item.label||'');

    return `
      <circle cx="${p.x}" cy="${p.y}" r="5" class="performance-point">
        <title>${escText(p.item.label)}: ${p.value.toFixed(1)}</title>
      </circle>
      <text x="${p.x}" y="${p.y-12}" text-anchor="middle" class="performance-value">${p.value.toFixed(1)}</text>
      <text x="${p.x}" y="${H-28}" text-anchor="middle" class="axis-text">${escText(shortName)}</text>
    `;
  }).join('');

  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" class="performance-trend-svg">
    ${grid.join('')}
    <path d="${line}" class="performance-line"/>
    ${marks}
    <line x1="${left}" y1="${top+plotH}" x2="${W-right}" y2="${top+plotH}" class="axis-line"/>
  </svg>`;
}

function renderMonthlyChart(ts,es,is){
  const svg=$('monthlyChart'); if(!svg)return;
  const months=Array.from({length:12},(_,i)=>i);
  const incomeBy=months.map(m=>is.filter(x=>Number(String(x.date||'').slice(5,7))-1===m).reduce((s,x)=>s+Number(x.amount||0),0));
  const expenseBy=months.map(m=>es.filter(x=>Number(String(x.date||'').slice(5,7))-1===m).reduce((s,x)=>s+Number(x.amount||0),0));
  ts.forEach(t=>{const m=Number(String(t.date||'').slice(5,7))-1;if(m>=0)expenseBy[m]+=expenseTotal(t);});
  const max=Math.max(...incomeBy,...expenseBy,1), W=760,H=280,left=52,right=18,top=24,bottom=42,plotW=W-left-right,plotH=H-top-bottom,step=plotW/12,barW=Math.min(18,step*.28);
  const grid=[]; for(let i=0;i<=4;i++){const y=top+plotH-(plotH*i/4),v=max*i/4;grid.push(`<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" class="gridline"/><text x="${left-8}" y="${y+4}" text-anchor="end" class="axis-text">${money(v).replace('₹','₹')}</text>`)}
  const bars=[]; const labels=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  months.forEach(i=>{const x=left+i*step+step/2; const ih=(incomeBy[i]/max)*plotH,eh=(expenseBy[i]/max)*plotH;bars.push(`<rect x="${x-barW-2}" y="${top+plotH-ih}" width="${barW}" height="${ih}" class="income-bar"><title>${labels[i]} income: ${money(incomeBy[i])}</title></rect><rect x="${x+2}" y="${top+plotH-eh}" width="${barW}" height="${eh}" class="expense-bar"><title>${labels[i]} expense: ${money(expenseBy[i])}</title></rect><text x="${x}" y="${H-14}" text-anchor="middle" class="axis-text">${labels[i]}</text>`)});
  svg.innerHTML=grid.join('')+bars.join('')+`<line x1="${left}" y1="${top+plotH}" x2="${W-right}" y2="${top+plotH}" class="axis-line"/><g transform="translate(${W-170},8)"><rect width="12" height="12" class="income-bar"/><text x="18" y="10" class="axis-text">Income</text><rect x="75" width="12" height="12" class="expense-bar"/><text x="93" y="10" class="axis-text">Expense</text></g>`;
}
function renderPerformance(){
  const selectedYear=$('performanceYear').value||'all';
  const rows=selectedYear==='all'
    ? data
    : data.filter(t=>yearOf(t.date)===selectedYear);

  const performanceRows=rows.filter(t=>Number(t.performance)>0);

  const values=performanceRows.map(t=>Number(t.performance));
  const average=values.length
    ? values.reduce((a,b)=>a+b,0)/values.length
    : 0;
  const best=values.length?Math.max(...values):0;

  const positions=performanceRows
    .map(t=>Number(t.position))
    .filter(p=>p>0);

  const bestPosition=positions.length?Math.min(...positions):0;

  $('perfCount').textContent=performanceRows.length;
  $('avgTPS').textContent=average?average.toFixed(1):'—';
  $('bestTPS').textContent=best?best.toFixed(1):'—';
  $('bestPosition').textContent=bestPosition?bestPosition:'—';

  const bestFormatEntry=Object.entries(
    performanceRows.reduce((map,t)=>{
      const key=t.format||'Other';
      if(!map[key])map[key]=[];
      map[key].push(Number(t.performance));
      return map;
    },{})
  )
  .map(([label,values])=>({
    label,
    value:values.reduce((a,b)=>a+b,0)/values.length
  }))
  .sort((a,b)=>b.value-a.value)[0];

  const bestCategoryEntry=Object.entries(
    performanceRows.reduce((map,t)=>{
      const key=cat(t)||'Other';
      if(!map[key])map[key]=[];
      map[key].push(Number(t.performance));
      return map;
    },{})
  )
  .map(([label,values])=>({
    label,
    value:values.reduce((a,b)=>a+b,0)/values.length
  }))
  .sort((a,b)=>b.value-a.value)[0];

  const bestModeEntry=Object.entries(
    performanceRows.reduce((map,t)=>{
      const key=t.mode||'Offline';
      if(!map[key])map[key]=[];
      map[key].push(Number(t.performance));
      return map;
    },{})
  )
  .map(([label,values])=>({
    label,
    value:values.reduce((a,b)=>a+b,0)/values.length
  }))
  .sort((a,b)=>b.value-a.value)[0];

  const bestTournament=performanceRows
    .slice()
    .sort((a,b)=>Number(b.performance)-Number(a.performance))[0];

  $('bestFormat').textContent=bestFormatEntry
    ? `${bestFormatEntry.label} (${bestFormatEntry.value.toFixed(1)})`
    : '—';

  $('bestCategory').textContent=bestCategoryEntry
    ? `${bestCategoryEntry.label} (${bestCategoryEntry.value.toFixed(1)})`
    : '—';

  $('bestMode').textContent=bestModeEntry
    ? `${bestModeEntry.label} (${bestModeEntry.value.toFixed(1)})`
    : '—';

  $('bestTournament').textContent=bestTournament
    ? `${bestTournament.name} (${Number(bestTournament.performance).toFixed(1)})`
    : '—';

  const formatMap={};
  performanceRows.forEach(t=>{
    const key=t.format||'Other';
    if(!formatMap[key])formatMap[key]=[];
    formatMap[key].push(Number(t.performance));
  });

  const formatData=Object.entries(formatMap)
    .map(([label,values])=>({
      label,
      value:values.reduce((a,b)=>a+b,0)/values.length
    }))
    .sort((a,b)=>b.value-a.value);

  renderBars(
    'performanceFormat',
    formatData,
    'No performance data'
  );

  const categoryMap={};
  performanceRows.forEach(t=>{
    const key=cat(t)||'Other';
    if(!categoryMap[key])categoryMap[key]=[];
    categoryMap[key].push(Number(t.performance));
  });

  const categoryData=Object.entries(categoryMap)
    .map(([label,values])=>({
      label,
      value:values.reduce((a,b)=>a+b,0)/values.length
    }))
    .sort((a,b)=>b.value-a.value);

  renderBars(
    'performanceCategory',
    categoryData,
    'No performance data'
  );

  const modeMap={};
  performanceRows.forEach(t=>{
    const key=t.mode||'Offline';
    if(!modeMap[key])modeMap[key]=[];
    modeMap[key].push(Number(t.performance));
  });

  const modeData=Object.entries(modeMap)
    .map(([label,values])=>({
      label,
      value:values.reduce((a,b)=>a+b,0)/values.length
    }))
    .sort((a,b)=>b.value-a.value);

  renderBars(
    'performanceMode',
    modeData,
    'No performance data'
  );

  const costData=performanceRows
    .map(t=>{
      const cost=
        Number(t.registration||0)+
        Number(t.travel||0)+
        Number(t.food||0)+
        Number(t.accommodation||0)+
        Number(t.other||0);

      if(cost<=0)return null;

      return {
        label:t.name,
        value:(Number(t.performance)/cost)*1000
      };
    })
    .filter(Boolean)
    .sort((a,b)=>b.value-a.value);

  renderBars(
    'performanceCost',
    costData,
    'No cost data available'
  );

  const trendData=performanceRows
    .slice()
    .sort((a,b)=>a.date.localeCompare(b.date))
    .map(t=>({
      label:t.name,
      value:Number(t.performance)
    }));

  renderPerformanceTrend(trendData);
}

function renderDashboard(){
  buildYearFilter();
  const {ts,es,is}=filteredDash();
  const performanceRows=ts.filter(t=>Number(t.performance)>0);
  const perfValues=performanceRows.map(t=>Number(t.performance));
  const avgTPS=perfValues.length?perfValues.reduce((a,b)=>a+b,0)/perfValues.length:0;
  const bestTPS=perfValues.length?Math.max(...perfValues):0;
  const positions=performanceRows.map(t=>Number(t.position)).filter(p=>p>0);
  const bestPosition=positions.length?Math.min(...positions):0;

  $('perfCount').textContent=performanceRows.length;
  $('avgTPS').textContent=avgTPS?avgTPS.toFixed(1):'—';
  $('bestTPS').textContent=bestTPS?bestTPS.toFixed(1):'—';
  $('bestPosition').textContent=bestPosition?bestPosition:'—';
  renderMonthlyChart(ts,es,is);
  const expenseMap={Registration:0,Travel:0,Food:0,Accommodation:0,Other:0};
  ts.forEach(t=>{expenseMap.Registration+=Number(t.registration||0);expenseMap.Travel+=Number(t.travel||0);expenseMap.Food+=Number(t.food||0);expenseMap.Accommodation+=Number(t.accommodation||0);expenseMap.Other+=Number(t.other||0)});
  es.forEach(e=>{const k=e.category||'Other';expenseMap[k]=(expenseMap[k]||0)+Number(e.amount||0)});
  renderBars('expenseChart',Object.entries(expenseMap).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value})),'No expenses in this period');
  const incomeMap={}; is.forEach(e=>{const k=e.category||'Other Income';incomeMap[k]=(incomeMap[k]||0)+Number(e.amount||0)}); ts.forEach(t=>{const v=Number(t.prize||0);if(v)incomeMap['Prize Money']=(incomeMap['Prize Money']||0)+v});
  renderBars('incomeChart',Object.entries(incomeMap).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value})),'No income in this period');
  const formatMap={}; ts.forEach(t=>{const k=t.format||'Other';formatMap[k]=(formatMap[k]||0)+1});
  renderBars('formatChart',Object.entries(formatMap).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value})).map(x=>({...x,displayCount:true})),'No tournaments in this period');
  const formatEl=$('formatChart'); if(formatEl) formatEl.innerHTML=formatEl.innerHTML.replace(/<div class="bar-value">₹[^<]+<\/div>/g,(m,off,whole)=>m); // values are counts; replace labels below
  if(formatEl){formatEl.innerHTML=Object.entries(formatMap).sort((a,b)=>b[1]-a[1]).map(([label,value])=>`<div class="bar-row"><div class="bar-label" title="${escText(label)}">${escText(label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,(value/Math.max(...Object.values(formatMap),1))*100)}%"></div></div><div class="bar-value">${value}</div></div>`).join('')||'<div class="chart-empty">No tournaments in this period</div>';}
}
function render(){
 let q=$('search').value.toLowerCase();let rows=data.filter(t=>(t.name+' '+t.location+' '+t.organizer+' '+(t.mode||'')+' '+(t.tournament_type||'')+' '+cat(t)+' '+t.format).toLowerCase().includes(q));
 $('count').textContent=data.length;const te=data.reduce((s,t)=>s+expenseTotal(t),0),ce=expenses.reduce((s,e)=>s+Number(e.amount||0),0),pr=data.reduce((s,t)=>s+Number(t.prize||0),0),inc=incomes.reduce((s,e)=>s+Number(e.amount||0),0),oe=te+ce,totalIncome=pr+inc; $('expense').textContent=money(te);$('chessExpense').textContent=money(ce);$('prize').textContent=money(pr);$('overall').textContent=money(oe);$('otherIncome').textContent=money(inc);$('totalIncome').textContent=money(totalIncome);$('netOverall').textContent=(totalIncome-oe>=0?'+':'-')+money(Math.abs(totalIncome-oe));$('netOverall').className=totalIncome-oe>=0?'positive':'negative';
 $('empty').style.display=rows.length?'none':'block';

 if(window.tournamentView==='list'){
   $('list').innerHTML=rows.length?`<div class="list-view"><table class="tournament-table"><thead><tr><th>Date</th><th>Tournament</th><th>Mode</th><th>Type</th><th>Category</th><th>Format</th><th>Position</th><th>Prize</th><th>Net</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(t.date)}</td><td><button class="clickable-name" onclick="showTournament('${t.id}')">${esc(t.name)}</button></td><td>${esc(t.mode||'Offline')}</td><td>${esc(t.tournament_type||'')}</td><td>${esc(cat(t))}</td><td>${esc(t.format||'')}</td><td>${t.position?t.position:'—'}</td><td>${money(t.prize)}</td><td><b class="${net(t)>=0?'positive':'negative'}">${net(t)>=0?'+':'-'}${money(Math.abs(net(t)))}</b></td></tr>`).join('')}</tbody></table></div>`:'';
 }else{
   $('list').innerHTML=rows.map(t=>`<div class="row"><div><h3>🏆 ${esc(t.name)}</h3><div class="meta">${esc(t.date)}${t.location?' • '+esc(t.location):''}</div><div class="meta">${esc(t.mode||'Offline')} • ${esc(t.tournament_type||'')} • ${esc(cat(t))} • ${esc(t.format||'')}${t.participants?' • '+t.participants+' participants':''}${t.position?' • '+t.position+'th place':''}${t.score?' • '+esc(t.score):''}</div><div class="actions"><button onclick="showTournament('${t.id}')">Details</button><button onclick="editT('${t.id}')">Edit</button><button onclick="delT('${t.id}')">Delete</button></div></div><div><b class="${net(t)>=0?'positive':'negative'}">${net(t)>=0?'+':'-'}${money(Math.abs(net(t)))}</b><div class="meta">Prize ${money(t.prize)}<br>Spent ${money(expenseTotal(t))}</div></div></div>`).join('');
 }
 let eq=$('expenseSearch').value.toLowerCase();let erows=expenses.filter(e=>(e.description+' '+e.category+' '+(e.notes||'')).toLowerCase().includes(eq));$('expenseEmpty').style.display=erows.length?'none':'block';$('expenseList').innerHTML=erows.map(e=>`<div class="row"><div><h3>♟ ${esc(e.description)}</h3><div class="meta">${esc(e.date)} • ${esc(e.category)}</div>${e.notes?`<div class="meta">${esc(e.notes)}</div>`:''}<div class="actions"><button onclick="editE('${e.id}')">Edit</button><button onclick="delE('${e.id}')">Delete</button></div></div><div><b>${money(e.amount)}</b></div></div>`).join('');
 let iq=$('incomeSearch').value.toLowerCase();let irows=incomes.filter(e=>(e.description+' '+e.category+' '+(e.notes||'')).toLowerCase().includes(iq));$('incomeEmpty').style.display=irows.length?'none':'block';$('incomeList').innerHTML=irows.map(e=>`<div class="row"><div><h3>♟ ${esc(e.description)}</h3><div class="meta">${esc(e.date)} • ${esc(e.category)}</div>${e.notes?`<div class="meta">${esc(e.notes)}</div>`:''}<div class="actions"><button onclick="editI('${e.id}')">Edit</button><button onclick="delI('${e.id}')">Delete</button></div></div><div><b class="positive">+${money(e.amount)}</b></div></div>`).join('');
}
 renderDashboard();

window.tournamentView='card';

window.showTournament=id=>{
  const t=data.find(x=>x.id===id);
  if(!t)return;

  const item=(label,value)=>`<div class="detail-item"><span>${label}</span><b>${esc(value||'—')}</b></div>`;

  $('detailsContent').innerHTML=`
    <div class="detail-grid">
      ${item('Tournament',t.name)}
      ${item('Date',t.date)}
      ${item('Mode',t.mode||'Offline')}
      ${item('Location',t.location)}
      ${item('Organizer',t.organizer)}
      ${item('Tournament Type',t.tournament_type)}
      ${item('Rating Category',cat(t))}
      ${item('Format',t.format)}
      ${item('Participants',t.participants)}
      ${item('Rounds',t.rounds)}
      ${item('Time Control',t.time_control)}
      ${item('Rating',t.rating)}
      ${item('Position',t.position)}
      ${item('Score',t.score)}
      ${item('Performance',t.performance)}
      ${item('Prize Money',money(t.prize))}
      ${item('Registration',money(t.registration))}
      ${item('Travel',money(t.travel))}
      ${item('Food',money(t.food))}
      ${item('Accommodation',money(t.accommodation))}
      ${item('Other Expense',money(t.other))}
      ${item('Total Tournament Expense',money(expenseTotal(t)))}
      ${item('Net Tournament Result',(net(t)>=0?'+':'-')+money(Math.abs(net(t))))}
    </div>
    ${t.notes?`<div class="detail-notes"><strong>Notes</strong><div>${esc(t.notes)}</div></div>`:''}
  `;

  $('detailsModal').classList.remove('hidden');

  $('detailsEdit').onclick=()=>{
    $('detailsModal').classList.add('hidden');
    openTournament(t);
  };
};

$('detailsClose').onclick=()=>$('detailsModal').classList.add('hidden');
$('detailsCloseBottom').onclick=()=>$('detailsModal').classList.add('hidden');

$('cardViewBtn').onclick=()=>{
  window.tournamentView='card';
  $('cardViewBtn').classList.add('active');
  $('listViewBtn').classList.remove('active');
  render();
};

$('listViewBtn').onclick=()=>{
  window.tournamentView='list';
  $('listViewBtn').classList.add('active');
  $('cardViewBtn').classList.remove('active');
  render();
};

function clearModalRequired(){['name','date','incomeDate','incomeDescription','incomeAmount','expenseDate','expenseDescription','expenseAmount'].forEach(id=>{const el=$(id);if(el)el.required=false})}
function calculateTPS(){
  const participants=Number($('participants').value||0);
  const rounds=Number($('rounds').value||0);
  const position=Number($('position').value||0);
  const points=Number($('score').value||0);

  if(!participants||participants<2||!rounds||rounds<1||!position||position<1||position>participants||points<0||points>rounds){
    $('performance').value='';
    return;
  }

  const scorePerformance=(points/rounds)*100;
  const positionPerformance=((participants-position)/(participants-1))*100;
  const tps=(scorePerformance*0.70)+(positionPerformance*0.30);

  $('performance').value=tps.toFixed(1);
}
function openTournament(t){clearModalRequired();mode='tournament';edit=t||null;$('title').textContent=t?'Edit Tournament':'Add Tournament';$('tournamentFields').classList.remove('hidden');$('expenseFields').classList.add('hidden');$('incomeFields').classList.add('hidden');$('expenseDescription').required=false;$('expenseAmount').required=false;let fields={id:'id',name:'name',date:'date',location:'location',organizer:'organizer',mode:'mode',tournamentType:'tournament_type',ratingCategory:'rating_category',customCategory:'custom_category',format:'format',participants:'participants',rounds:'rounds',time:'time_control',rating:'rating',position:'position',score:'score',performance:'performance',prizeInput:'prize',registration:'registration',travel:'travel',food:'food',accommodation:'accommodation',other:'other',notes:'notes'};for(const [id,key] of Object.entries(fields))$(id).value=t?(t[key]??''):'';if(!t){$('date').value=today();$('tournamentType').value='Open';$('ratingCategory').value='Open';$('format').value='Classical';$('mode').value='Offline';['prizeInput','registration','travel','food','accommodation','other'].forEach(id=>$(id).value=0)}calc();$('modal').classList.remove('hidden')}
function openIncome(e){clearModalRequired();mode='income';edit=e||null;$('title').textContent=e?'Edit Chess Income':'Add Chess Income';$('tournamentFields').classList.add('hidden');$('expenseFields').classList.add('hidden');$('incomeFields').classList.remove('hidden');$('expenseDescription').required=false;$('expenseAmount').required=false;$('incomeDescription').required=true;$('incomeAmount').required=true;$('incomeDate').value=e?.date||today();$('incomeCategory').value=e?.category||'Coaching / Training';$('incomeDescription').value=e?.description||'';$('incomeAmount').value=e?.amount??'';$('incomeNotes').value=e?.notes||'';$('modal').classList.remove('hidden')}
function openExpense(e){clearModalRequired();mode='expense';edit=e||null;$('title').textContent=e?'Edit Chess Expense':'Add Chess Expense';$('tournamentFields').classList.add('hidden');$('expenseFields').classList.remove('hidden');$('incomeFields').classList.add('hidden');$('expenseDescription').required=true;$('expenseAmount').required=true;$('id').value=e?.id||'';$('expenseDate').value=e?.date||today();$('expenseCategory').value=e?.category||'Chess Books';$('expenseDescription').value=e?.description||'';$('expenseAmount').value=e?.amount??'';$('expenseNotes').value=e?.notes||'';$('modal').classList.remove('hidden')}
function close(){$('modal').classList.add('hidden')}
window.editT=id=>openTournament(data.find(t=>t.id===id));window.editE=id=>openExpense(expenses.find(e=>e.id===id));window.editI=id=>openIncome(incomes.find(e=>e.id===id));
window.delT=async id=>{if(confirm('Delete this tournament?')){await db.execute('DELETE FROM tournaments WHERE id=?',[id]);await load()}};
window.delE=async id=>{if(confirm('Delete this chess expense?')){await db.execute('DELETE FROM chess_expenses WHERE id=?',[id]);await load()}};window.delI=async id=>{if(confirm('Delete this chess income?')){await db.execute('DELETE FROM chess_income WHERE id=?',[id]);await load()}};
function calc(){let e=['registration','travel','food','accommodation','other'].reduce((s,id)=>s+Number($(id).value||0),0),n=Number($('prizeInput').value||0)-e;$('total').textContent=money(e);$('result').textContent=(n>=0?'+':'-')+money(Math.abs(n));$('result').className=n>=0?'positive':'negative'}
$('addBtn').onclick=()=>openTournament();$('addExpenseBtn').onclick=()=>openExpense();$('addIncomeBtn').onclick=()=>openIncome();$('close').onclick=close;$('cancel').onclick=close;$('search').oninput=render;$('expenseSearch').oninput=render;$('incomeSearch').oninput=render;['registration','travel','food','accommodation','other','prizeInput'].forEach(id=>$(id).oninput=calc);
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');let tab=btn.dataset.tab;$('dashboardSection').classList.toggle('hidden',tab!=='dashboard');$('tournamentSection').classList.toggle('hidden',tab!=='tournaments');$('expenseSection').classList.toggle('hidden',tab!=='expenses');$('incomeSection').classList.toggle('hidden',tab!=='income');$('performanceSection').classList.toggle('hidden',tab!=='performance');if(tab==='dashboard')renderDashboard();if(tab==='performance')renderPerformance()});
$('dashYear').onchange=()=>{dashYear=$('dashYear').value;renderDashboard()};

$('performanceYear').onchange=()=>renderPerformance();
function buildPerformanceYearFilter(){
  const sel=$('performanceYear');
  if(!sel)return;
  const current=sel.value||'all';
  const years=[...new Set(data.map(t=>yearOf(t.date)).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  sel.innerHTML='<option value="all">All Years</option>'+years.map(y=>`<option value="${y}">${y}</option>`).join('');
  sel.value=years.includes(current)?current:'all';
}
buildPerformanceYearFilter();

$('form').onsubmit=async e=>{e.preventDefault();try{if(mode==='expense'){const id=edit?.id||newId(),date=$('expenseDate').value,description=$('expenseDescription').value.trim(),amount=Number($('expenseAmount').value);if(!date||!description||!(amount>0)){alert('Please enter Date, Description and a valid Amount.');return}const x=[id,date,$('expenseCategory').value,description,amount,$('expenseNotes').value.trim()];if(edit)await db.execute('UPDATE chess_expenses SET date=?,category=?,description=?,amount=?,notes=? WHERE id=?',[x[1],x[2],x[3],x[4],x[5],id]);else await db.execute('INSERT INTO chess_expenses (id,date,category,description,amount,notes) VALUES (?,?,?,?,?,?)',x);close();await load();return}
if(mode==='income'){const id=edit?.id||newId(),date=$('incomeDate').value,description=$('incomeDescription').value.trim(),amount=Number($('incomeAmount').value);if(!date||!description||!(amount>0)){alert('Please enter Date, Description and a valid Amount.');return}const x=[id,date,$('incomeCategory').value,description,amount,$('incomeNotes').value.trim()];if(edit)await db.execute('UPDATE chess_income SET date=?,category=?,description=?,amount=?,notes=? WHERE id=?',[x[1],x[2],x[3],x[4],x[5],id]);else await db.execute('INSERT INTO chess_income (id,date,category,description,amount,notes) VALUES (?,?,?,?,?,?)',x);close();await load();return}
const id=edit?.id||newId();const vals={name:$('name').value.trim(),date:$('date').value,location:$('location').value.trim(),organizer:$('organizer').value.trim(),mode:$('mode').value,tournament_type:$('tournamentType').value,rating_category:$('ratingCategory').value,custom_category:$('customCategory').value.trim(),format:$('format').value,participants:Number($('participants').value||0),rounds:Number($('rounds').value||0),time_control:$('time').value.trim(),rating:Number($('rating').value||0),position:Number($('position').value||0),score:$('score').value.trim(),performance:Number($('performance').value||0),prize:Number($('prizeInput').value||0),registration:Number($('registration').value||0),travel:Number($('travel').value||0),food:Number($('food').value||0),accommodation:Number($('accommodation').value||0),other:Number($('other').value||0),notes:$('notes').value.trim()};if(!vals.name||!vals.date){alert('Please enter tournament name and date.');return}const p=[vals.name,vals.date,vals.location,vals.organizer,vals.tournament_type,vals.rating_category,vals.custom_category,vals.format,vals.participants,vals.rounds,vals.time_control,vals.rating,vals.position,vals.score,vals.performance,vals.prize,vals.registration,vals.travel,vals.food,vals.accommodation,vals.other,vals.notes];if(edit)await db.execute(`UPDATE tournaments SET name=?,date=?,location=?,organizer=?,mode=?,tournament_type=?,rating_category=?,custom_category=?,format=?,participants=?,rounds=?,time_control=?,rating=?,position=?,score=?,performance=?,prize=?,registration=?,travel=?,food=?,accommodation=?,other=?,notes=? WHERE id=?`,[vals.name,vals.date,vals.location,vals.organizer,vals.mode,...p.slice(4),id]);else await db.execute(`INSERT INTO tournaments (id,name,date,location,organizer,mode,tournament_type,rating_category,custom_category,format,participants,rounds,time_control,rating,position,score,performance,prize,registration,travel,food,accommodation,other,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,vals.name,vals.date,vals.location,vals.organizer,vals.mode,...p.slice(4)]);close();await load()}catch(err){console.error(err);alert('Could not save. '+err)}};
async function backup(){
  try{
    const payload={version:4,exportedAt:new Date().toISOString(),tournaments:data,expenses,incomes};
    const path=await save({
      defaultPath:'chess-ledger-backup.json',
      filters:[{name:'Chess Ledger Backup',extensions:['json']}]
    });
    if(!path)return;
    await writeTextFile(path,JSON.stringify(payload,null,2));
    alert('Backup saved successfully.');
  }catch(err){
    alert('Could not create backup: '+err.message);
  }
}
$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreFile').click();$('restoreFile').onchange=async()=>{const f=$('restoreFile').files[0];if(!f)return;try{const p=JSON.parse(await f.text());if(!Array.isArray(p.tournaments)||!Array.isArray(p.expenses))throw new Error('Invalid backup');if(!Array.isArray(p.incomes))p.incomes=[];if(!confirm('Restore backup? Existing data will be replaced.'))return;await db.execute('DELETE FROM tournaments');await db.execute('DELETE FROM chess_expenses');await db.execute('DELETE FROM chess_income');for(const t of p.tournaments){await db.execute(`INSERT INTO tournaments (id,name,date,location,organizer,tournament_type,rating_category,custom_category,format,participants,rounds,time_control,rating,position,score,performance,prize,registration,travel,food,accommodation,other,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[t.id||newId(),t.name||'',t.date||today(),t.location||'',t.organizer||'',t.tournament_type||t.tournamentType||'Open',t.rating_category||t.ratingCategory||'Open',t.custom_category||t.customCategory||'',t.format||'Classical',Number(t.participants||0),Number(t.rounds||0),t.time_control||t.time||'',Number(t.rating||0),Number(t.position||0),t.score||'',Number(t.performance||0),Number(t.prize||0),Number(t.registration||0),Number(t.travel||0),Number(t.food||0),Number(t.accommodation||0),Number(t.other||0),t.notes||''])}for(const x of p.expenses){await db.execute('INSERT INTO chess_expenses (id,date,category,description,amount,notes) VALUES (?,?,?,?,?,?)',[x.id||newId(),x.date||today(),x.category||'Other Chess Expense',x.description||'Expense',Number(x.amount||0),x.notes||''])}for(const x of p.incomes){await db.execute('INSERT INTO chess_income (id,date,category,description,amount,notes) VALUES (?,?,?,?,?,?)',[x.id||newId(),x.date||today(),x.category||'Other Chess Income',x.description||'Income',Number(x.amount||0),x.notes||''])}await load();alert('Backup restored successfully.')}catch(err){alert('Could not restore backup: '+err.message)}$('restoreFile').value=''};
init().catch(err=>{console.error(err);document.body.insertAdjacentHTML('afterbegin','<div style="padding:12px;background:#fee;color:#900">Database could not be opened. Please run the Tauri app, not index.html directly.</div>')});
['participants','rounds','position','score'].forEach(id=>{
  $(id).addEventListener('input',calculateTPS);
});
