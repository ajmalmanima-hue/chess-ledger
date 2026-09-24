import Database from '@tauri-apps/plugin-sql';
import { save, confirm as dialogConfirm } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let db;
let data=[];
let events=[];
let calendarDate=new Date();
let expenses=[];
let incomes=[];
let edit=null;
let mode='tournament';
let dashYear='all';
const $=x=>document.getElementById(x);
const currencyOptions={
  INR:{name:'Indian Rupee',symbol:'₹',locale:'en-IN'},
  USD:{name:'US Dollar',symbol:'$',locale:'en-US'},
  EUR:{name:'Euro',symbol:'€',locale:'de-DE'},
  GBP:{name:'British Pound',symbol:'£',locale:'en-GB'},
  AED:{name:'UAE Dirham',symbol:'د.إ',locale:'en-AE'},
  SAR:{name:'Saudi Riyal',symbol:'﷼',locale:'en-SA'},
  JPY:{name:'Japanese Yen',symbol:'¥',locale:'ja-JP'},
  CAD:{name:'Canadian Dollar',symbol:'CA$',locale:'en-CA'},
  AUD:{name:'Australian Dollar',symbol:'A$',locale:'en-AU'},
  CHF:{name:'Swiss Franc',symbol:'CHF',locale:'de-CH'}
};

let selectedCurrency=localStorage.getItem('chessLedgerCurrency')||'INR';

function setupCurrency(){
  const select=$('currencySelect');
  if(!select)return;

  select.innerHTML=Object.entries(currencyOptions)
    .map(([code,c])=>`<option value="${code}">${c.name} (${c.symbol})</option>`)
    .join('');

  select.value=currencyOptions[selectedCurrency]
    ? selectedCurrency
    : 'INR';

  selectedCurrency=select.value;

  select.onchange=()=>{
    selectedCurrency=select.value;
    localStorage.setItem('chessLedgerCurrency',selectedCurrency);
    render();
  };
}

const money=n=>{
  const c=currencyOptions[selectedCurrency]||currencyOptions.INR;
  return c.symbol+Number(n||0).toLocaleString(c.locale,{
    maximumFractionDigits:2
  });
};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const newId=()=>crypto.randomUUID();

async function recordUsage(){
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_usage`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':SUPABASE_ANON_KEY,
        'Authorization':`Bearer ${SUPABASE_ANON_KEY}`
      },
      body:JSON.stringify({
        p_installation_id:installationId,
        p_platform:navigator.userAgent.includes('Windows')?'Windows':
          navigator.userAgent.includes('Linux')?'Linux':'Other',
        p_app_version:'0.2.0'
      })
    });
  }catch(err){
    console.warn('Usage statistics unavailable:',err);
  }
}


const installationId=
  localStorage.getItem('chessLedgerInstallationId')||
  crypto.randomUUID();

localStorage.setItem(
  'chessLedgerInstallationId',
  installationId
);
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
  await db.execute(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT,
    organizer TEXT,
    mode TEXT DEFAULT 'Offline',
    format TEXT DEFAULT 'Classical',
    deadline TEXT,
    reminder INTEGER DEFAULT -1,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
await load();
}
async function load(){
data=await db.select('SELECT * FROM tournaments ORDER BY date DESC, created_at DESC');expenses=await db.select('SELECT * FROM chess_expenses ORDER BY date DESC, created_at DESC');incomes=await db.select('SELECT * FROM chess_income ORDER BY date DESC, created_at DESC');events=await db.select('SELECT * FROM events ORDER BY date ASC, created_at ASC');
buildPerformanceYearFilter();render();checkEventReminders()}
function yearOf(date){return String(date||'').slice(0,4)}
function escText(x){return esc(x)}
function buildYearFilter(){
  const years=new Set();
  data.forEach(t=>years.add(yearOf(t.date)));
  expenses.forEach(e=>years.add(yearOf(e.date)));
  incomes.forEach(e=>years.add(yearOf(e.date)));
  const yearsArr=[...years].filter(Boolean).sort((a,b)=>b.localeCompare(a));
  const sel=$('dashYear'); if(!sel)return;
const tournamentYear=$('filterYear');
if(tournamentYear){
  const currentTournamentYear=tournamentYear.value||'all';
  tournamentYear.innerHTML='<option value="all">All Years</option>'+yearsArr.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');
  tournamentYear.value=yearsArr.includes(currentTournamentYear)?currentTournamentYear:'all';
}
  const current=sel.value||dashYear||'all';
  sel.innerHTML='<option value="all">All Years</option>'+yearsArr.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');
  sel.value=yearsArr.includes(current)?current:'all'; dashYear=sel.value;
}
function filteredDash(){
  if(dashYear==='all') return {ts:data,es:expenses,is:incomes};
  return {ts:data.filter(t=>yearOf(t.date)===dashYear),es:expenses.filter(e=>yearOf(e.date)===dashYear),is:incomes.filter(e=>yearOf(e.date)===dashYear)};
}
function renderBars(id, items, empty='No data', plainNumber=false){
  const el=$(id); if(!el)return;
  if(!items.length){el.innerHTML=`<div class="chart-empty">${empty}</div>`;return;}
  const max=Math.max(...items.map(x=>x.value),1);
  el.innerHTML=items.map(x=>`<div class="bar-row"><div class="bar-label" title="${escText(x.label)}">${escText(x.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,(x.value/max)*100)}%"></div></div><div class="bar-value">${plainNumber?Number(x.value).toFixed(1):money(x.value)}</div></div>`).join('');
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
  const grid=[]; for(let i=0;i<=4;i++){const y=top+plotH-(plotH*i/4),v=max*i/4;grid.push(`<line x1="${left}" y1="${y}" x2="${W-right}" y2="${y}" class="gridline"/><text x="${left-8}" y="${y+4}" text-anchor="end" class="axis-text">${money(v)}</text>`)}
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

  $('perfCount').textContent=rows.length;
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
  'No performance data',
  true
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
  'No performance data',
  true
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
  'No performance data',
  true
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
  'No cost data available',
  true
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

  $('count').textContent=ts.length;

  const tournamentExpense=ts.reduce((s,t)=>s+expenseTotal(t),0);
  const chessExpense=es.reduce((s,e)=>s+Number(e.amount||0),0);
  const prize=ts.reduce((s,t)=>s+Number(t.prize||0),0);
  const otherIncome=is.reduce((s,e)=>s+Number(e.amount||0),0);

  const overallExpense=tournamentExpense+chessExpense;
  const totalIncome=prize+otherIncome;
  const netResult=totalIncome-overallExpense;

  $('expense').textContent=money(tournamentExpense);
  $('chessExpense').textContent=money(chessExpense);
  $('prize').textContent=money(prize);
  $('otherIncome').textContent=money(otherIncome);
  $('totalIncome').textContent=money(totalIncome);
  $('overall').textContent=money(overallExpense);
  $('netOverall').textContent=(netResult>=0?'+':'-')+money(Math.abs(netResult));
  $('netOverall').className=netResult>=0?'positive':'negative';

  renderMonthlyChart(ts,es,is);

  const expenseMap={
    Registration:0,
    Travel:0,
    Food:0,
    Accommodation:0,
    Other:0
  };

  ts.forEach(t=>{
    expenseMap.Registration+=Number(t.registration||0);
    expenseMap.Travel+=Number(t.travel||0);
    expenseMap.Food+=Number(t.food||0);
    expenseMap.Accommodation+=Number(t.accommodation||0);
    expenseMap.Other+=Number(t.other||0);
  });

  es.forEach(e=>{
    const k=e.category||'Other';
    expenseMap[k]=(expenseMap[k]||0)+Number(e.amount||0);
  });

  renderBars(
    'expenseChart',
    Object.entries(expenseMap)
      .filter(([,v])=>v>0)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,value])=>({label,value})),
    'No expenses in this period'
  );

  const incomeMap={
    'Other Income':0,
    'Prize Money':0
  };

  is.forEach(e=>{
    incomeMap['Other Income']+=Number(e.amount||0);
  });

  ts.forEach(t=>{
    incomeMap['Prize Money']+=Number(t.prize||0);
  });

  renderBars(
    'incomeChart',
    Object.entries(incomeMap)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,value])=>({label,value})),
    'No income in this period'
  );

  const formatMap={};

  ts.forEach(t=>{
    const k=t.format||'Other';
    formatMap[k]=(formatMap[k]||0)+1;
  });

  const formatEl=$('formatChart');

  if(formatEl){
    const entries=Object.entries(formatMap)
      .sort((a,b)=>b[1]-a[1]);

    const max=Math.max(...Object.values(formatMap),1);

    formatEl.innerHTML=entries.length
      ? entries.map(([label,value])=>`
          <div class="bar-row">
            <div class="bar-label" title="${escText(label)}">${escText(label)}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.max(2,(value/max)*100)}%"></div>
            </div>
            <div class="bar-value">${value}</div>
          </div>
        `).join('')
      : '<div class="chart-empty">No tournaments in this period</div>';
  }
}
function buildExpenseIncomeYearFilter(id,current){
  const sel=$(id);
  if(!sel)return 'all';

  const years=new Set();

  if(id==='expenseYear'){
    expenses.forEach(e=>years.add(yearOf(e.date)));
  }else{
    incomes.forEach(e=>years.add(yearOf(e.date)));
  }

  const yearsArr=[...years].filter(Boolean).sort((a,b)=>b.localeCompare(a));

  sel.innerHTML='<option value="all">All Years</option>'+
    yearsArr.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');

  const value=yearsArr.includes(current)?current:'all';
  sel.value=value;

  return value;
}

function renderExpenseIncomeDashboard(){
  const expenseYear=$('expenseYear')?.value||'all';
  const incomeYear=$('incomeYear')?.value||'all';

  const filteredExpenses=expenseYear==='all'
    ? expenses
    : expenses.filter(e=>yearOf(e.date)===expenseYear);

  const filteredIncomes=incomeYear==='all'
    ? incomes
    : incomes.filter(e=>yearOf(e.date)===incomeYear);

  const expenseTotal=filteredExpenses.reduce(
    (sum,e)=>sum+Number(e.amount||0),0
  );

  const incomeTotal=filteredIncomes.reduce(
    (sum,e)=>sum+Number(e.amount||0),0
  );

  const expenseAverage=filteredExpenses.length
    ? expenseTotal/filteredExpenses.length
    : 0;

  const incomeAverage=filteredIncomes.length
    ? incomeTotal/filteredIncomes.length
    : 0;

  const now=new Date();
  const currentMonth=String(now.getMonth()+1).padStart(2,'0');
  const currentYear=String(now.getFullYear());

  const expenseMonth=filteredExpenses
    .filter(e=>{
      const date=String(e.date||'');
      return date.startsWith(`${currentYear}-${currentMonth}`);
    })
    .reduce((sum,e)=>sum+Number(e.amount||0),0);

  const incomeMonth=filteredIncomes
    .filter(e=>{
      const date=String(e.date||'');
      return date.startsWith(`${currentYear}-${currentMonth}`);
    })
    .reduce((sum,e)=>sum+Number(e.amount||0),0);

  $('expenseTabTotal').textContent=money(expenseTotal);
  $('expenseTabMonth').textContent=money(expenseMonth);
  $('expenseTabCount').textContent=filteredExpenses.length;
  $('expenseTabAverage').textContent=money(expenseAverage);

  $('incomeTabTotal').textContent=money(incomeTotal);
  $('incomeTabMonth').textContent=money(incomeMonth);
  $('incomeTabCount').textContent=filteredIncomes.length;
  $('incomeTabAverage').textContent=money(incomeAverage);

  const expenseMap={};

  filteredExpenses.forEach(e=>{
    const key=e.category||'Other Expense';
    expenseMap[key]=(expenseMap[key]||0)+Number(e.amount||0);
  });

  renderBars(
    'expenseCategoryChart',
    Object.entries(expenseMap)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,value])=>({label,value})),
    'No expenses in this period'
  );

  const incomeMap={};

  filteredIncomes.forEach(e=>{
    const key=e.category||'Other Income';
    incomeMap[key]=(incomeMap[key]||0)+Number(e.amount||0);
  });

  renderBars(
    'incomeCategoryChart',
    Object.entries(incomeMap)
      .sort((a,b)=>b[1]-a[1])
      .map(([label,value])=>({label,value})),
    'No income in this period'
  );
}
function renderExpenseList(rows){
  const el=$('expenseList');
  if(!el)return;

  if(window.expenseView==='list'){
    el.innerHTML=rows.length
      ? `<div class="list-view"><table class="tournament-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(e=>`
              <tr>
                <td>${esc(e.date)}</td>
                <td>${esc(e.description)}</td>
                <td>${esc(e.category)}</td>
                <td><b>${money(e.amount)}</b></td>
                <td>
                  <div class="actions">
                    <button onclick="editE('${e.id}')">Edit</button>
                    <button onclick="delE('${e.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>`
      : '';
  }else{
    el.innerHTML=rows.map(e=>`
      <div class="row">
        <div>
          <h3>♟ ${esc(e.description)}</h3>
          <div class="meta">${esc(e.date)} • ${esc(e.category)}</div>
          ${e.notes?`<div class="meta">${esc(e.notes)}</div>`:''}
          <div class="actions">
            <button onclick="editE('${e.id}')">Edit</button>
            <button onclick="delE('${e.id}')">Delete</button>
          </div>
        </div>
        <div>
          <b>${money(e.amount)}</b>
        </div>
      </div>
    `).join('');
  }
}

function renderIncomeList(rows){
  const el=$('incomeList');
  if(!el)return;

  if(window.incomeView==='list'){
    el.innerHTML=rows.length
      ? `<div class="list-view"><table class="tournament-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(e=>`
              <tr>
                <td>${esc(e.date)}</td>
                <td>${esc(e.description)}</td>
                <td>${esc(e.category)}</td>
                <td><b class="positive">+${money(e.amount)}</b></td>
                <td>
                  <div class="actions">
                    <button onclick="editI('${e.id}')">Edit</button>
                    <button onclick="delI('${e.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>`
      : '';
  }else{
    el.innerHTML=rows.map(e=>`
      <div class="row">
        <div>
          <h3>♟ ${esc(e.description)}</h3>
          <div class="meta">${esc(e.date)} • ${esc(e.category)}</div>
          ${e.notes?`<div class="meta">${esc(e.notes)}</div>`:''}
          <div class="actions">
            <button onclick="editI('${e.id}')">Edit</button>
            <button onclick="delI('${e.id}')">Delete</button>
          </div>
        </div>
        <div>
          <b class="positive">+${money(e.amount)}</b>
        </div>
      </div>
    `).join('');
  }
}

window.expenseView='card';
window.incomeView='card';

function renderCalendar(){
  const year=calendarDate.getFullYear();
  const month=calendarDate.getMonth();

  $('calendarMonth').textContent=
    calendarDate.toLocaleString('default',{
      month:'long',
      year:'numeric'
    });

  const firstDay=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const start=(firstDay+6)%7;

  let html=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map(d=>`<div class="calendar-day-name">${d}</div>`)
    .join('');

  for(let i=0;i<start;i++){
    html+='<div class="calendar-day empty"></div>';
  }

  for(let day=1;day<=daysInMonth;day++){
    const dateKey=
      `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

    const dayEvents=events.filter(e=>e.date===dateKey);
    const dayTournaments=data.filter(t=>t.date===dateKey);

    html+=`
      <div class="calendar-day${dateKey===today()?' today':''}">
        <div class="calendar-date">${day}</div>

        ${dayTournaments.map(t=>`
          <div class="calendar-event tournament-event">
            🏆 ${escText(t.name)}
          </div>
        `).join('')}

        ${dayEvents.map(e=>`
          <div class="calendar-event">
            📅 ${escText(e.name)}
          </div>
        `).join('')}
      </div>
    `;
  }

  $('calendarGrid').innerHTML=html;

  const todayDate=today();

  const upcoming=[
    ...events
      .filter(e=>e.date>=todayDate)
      .map(e=>({...e,eventType:'event'})),
    ...data
      .filter(t=>t.date>=todayDate)
      .map(t=>({...t,eventType:'tournament'}))
  ].sort((a,b)=>a.date.localeCompare(b.date));

  const past=[
    ...events
      .filter(e=>e.date<todayDate)
      .map(e=>({...e,eventType:'event'})),
    ...data
      .filter(t=>t.date<todayDate)
      .map(t=>({...t,eventType:'tournament'}))
  ].sort((a,b)=>b.date.localeCompare(a.date));

  renderCalendarList('upcomingEvents',upcoming,true);
  renderCalendarList('pastEvents',past,false);
}

function renderCalendarList(id,rows,upcoming){
  const el=$(id);
  if(!el)return;

  if(!rows.length){
    el.innerHTML=`
      <div class="chart-empty">
        ${upcoming?'No upcoming events.':'No past events.'}
      </div>
    `;
    return;
  }

  el.innerHTML=rows.map(e=>`
    <div class="row calendar-list-row">
      <div>
        <h3>${e.eventType==='tournament'?'🏆':'📅'} ${esc(e.name)}</h3>

        <div class="meta">
          ${esc(e.date)}
          ${e.location?' • '+esc(e.location):''}
          ${e.format?' • '+esc(e.format):''}
        </div>

        ${e.organizer?`<div class="meta">${esc(e.organizer)}</div>`:''}

        ${e.eventType==='event'
          ?`<div class="actions">
              <button onclick="editEvent('${e.id}')">Edit</button>
              <button onclick="convertEvent('${e.id}')">🏆 Convert to Tournament</button>
              <button onclick="deleteEvent('${e.id}')">Delete</button>
            </div>`
          :''
        }
      </div>
    </div>
  `).join('');
}

window.editEvent=id=>{
  const e=events.find(x=>x.id===id);
  if(!e)return;

  $('eventModalTitle').textContent='Edit Event';
  $('eventId').value=e.id||'';
  $('eventName').value=e.name||'';
  $('eventDate').value='';
  if(e.date){
    const parts=e.date.split('-');
    if(parts.length===3)$('eventDate').value=`${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  $('eventLocation').value=e.location||'';
  $('eventOrganizer').value=e.organizer||'';
  $('eventMode').value=e.mode||'Offline';
  $('eventFormat').value=e.format||'Classical';
  $('eventDeadline').value='';
  if(e.deadline){
    const parts=e.deadline.split('-');
    if(parts.length===3)$('eventDeadline').value=`${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  $('eventReminder').value=e.reminder??'-1';
  $('eventNotes').value=e.notes||'';

  $('eventModal').classList.remove('hidden');
};

window.convertEvent=id=>{
  const e=events.find(x=>x.id===id);
  if(!e)return;

  openTournament({
    name:e.name||'',
    date:e.date||today(),
    location:e.location||'',
    organizer:e.organizer||'',
    mode:e.mode||'Offline',
    tournament_type:'Open',
    rating_category:'Open',
    custom_category:'',
    format:e.format||'Classical',
    participants:0,
    rounds:0,
    time_control:'',
    rating:0,
    position:0,
    score:'',
    performance:0,
    prize:0,
    registration:0,
    travel:0,
    food:0,
    accommodation:0,
    other:0,
    notes:e.notes||''
  });

  edit=null;
  window.convertingEventId=id;
};

window.deleteEvent=async id=>{
  const e=events.find(x=>x.id===id);
  if(!e)return;

  if(!confirm(`Delete "${e.name}"?`))return;

  try{
    await db.execute('DELETE FROM events WHERE id=?',[id]);
    await load();
    renderCalendar();
  }catch(err){
    console.error(err);
    alert('Could not delete event. '+err);
  }
};


function openEvent(){
  $('eventModalTitle').textContent='Add Event';
  $('eventId').value='';
  $('eventName').value='';
  $('eventDate').value='';
  $('eventLocation').value='';
  $('eventOrganizer').value='';
  $('eventMode').value='Offline';
  $('eventFormat').value='Classical';
  $('eventDeadline').value='';
  $('eventReminder').value='-1';
  $('eventNotes').value='';

  $('eventModal').classList.remove('hidden');
}

$('addEventBtn').onclick=()=>openEvent();

$('eventClose').onclick=()=>{
  $('eventModal').classList.add('hidden');
};

$('eventCancel').onclick=()=>{
  $('eventModal').classList.add('hidden');
};

$('eventForm').onsubmit=async e=>{
  e.preventDefault();

  const existingId=$('eventId').value.trim();
  const id=existingId||newId();

  const name=$('eventName').value.trim();
  const eventDateInput=$('eventDate').value.trim();
  const date=parseTournamentDate(eventDateInput);
  const location=$('eventLocation').value.trim();
  const organizer=$('eventOrganizer').value.trim();
  const mode=$('eventMode').value;
  const format=$('eventFormat').value;
  const deadlineInput=$('eventDeadline').value.trim();
  const deadline=deadlineInput?parseTournamentDate(deadlineInput):'';
  if(deadlineInput&&!deadline){
    alert('Please enter a valid deadline in DD-MM-YYYY format.');
    return;
  }
  const reminder=Number($('eventReminder').value);
  const notes=$('eventNotes').value.trim();

  if(!name||!date){
    alert('Please enter Event Name and a valid date in DD-MM-YYYY format.');
    return;
  }

  try{
    if(existingId){
      await db.execute(`
        UPDATE events
        SET name=?,date=?,location=?,organizer=?,mode=?,format=?,deadline=?,reminder=?,notes=?
        WHERE id=?
      `,[
        name,date,location,organizer,mode,format,
        deadline,reminder,notes,id
      ]);

      alert('Event updated successfully.');
    }else{
      await db.execute(`
        INSERT INTO events
        (id,name,date,location,organizer,mode,format,deadline,reminder,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `,[
        id,name,date,location,organizer,mode,format,
        deadline,reminder,notes
      ]);

      alert('Event saved successfully.');
    }

    $('eventModal').classList.add('hidden');

    await load();
    renderCalendar();

  }catch(err){
    console.error(err);
    alert('Could not save event. '+err);
  }
};




function checkEventReminders(){
  const todayDate=today();

  const reminders=events.filter(e=>{
    if(Number(e.reminder)<0)return false;
    if(!e.date)return false;

    const eventDate=new Date(e.date+'T00:00:00');
    const todayObj=new Date(todayDate+'T00:00:00');
    const diff=Math.round((eventDate-todayObj)/(1000*60*60*24));

    return diff===Number(e.reminder);
  });

  if(!reminders.length)return;

  const message=reminders.map(e=>{
    const diff=Number(e.reminder);
    const when=diff===0
      ? 'today'
      : diff===1
        ? 'tomorrow'
        : `in ${diff} days`;

    return `📅 ${e.name} — ${e.date} (${when})`;
  }).join('\n');

  alert(`Upcoming Chess Events\n\n${message}`);
}


function render(){
let q=$('search').value.toLowerCase();let modeFilter=$('filterMode').value;let typeFilter=$('filterType').value;let formatFilter=$('filterFormat').value;let categoryFilter=$('filterCategory').value;let yearFilter=$('filterYear').value;let rows=data.filter(t=>(t.name+' '+t.location+' '+t.organizer+' '+(t.mode||'')+' '+(t.tournament_type||'')+' '+cat(t)+' '+t.format).toLowerCase().includes(q)&&(modeFilter==='all'||(t.mode||'Offline')===modeFilter)&&(typeFilter==='all'||(t.tournament_type||'Open')===typeFilter)&&(formatFilter==='all'||(t.format||'Classical')===formatFilter)&&(categoryFilter==='all'||(cat(t)||'Open')===categoryFilter)&&(yearFilter==='all'||yearOf(t.date)===yearFilter));
 $('count').textContent=data.length;const te=data.reduce((s,t)=>s+expenseTotal(t),0),ce=expenses.reduce((s,e)=>s+Number(e.amount||0),0),pr=data.reduce((s,t)=>s+Number(t.prize||0),0),inc=incomes.reduce((s,e)=>s+Number(e.amount||0),0),oe=te+ce,totalIncome=pr+inc; $('expense').textContent=money(te);$('chessExpense').textContent=money(ce);$('prize').textContent=money(pr);$('overall').textContent=money(oe);$('otherIncome').textContent=money(inc);$('totalIncome').textContent=money(totalIncome);$('netOverall').textContent=(totalIncome-oe>=0?'+':'-')+money(Math.abs(totalIncome-oe));$('netOverall').className=totalIncome-oe>=0?'positive':'negative';
 $('empty').style.display=rows.length?'none':'block';

 if(window.tournamentView==='list'){
   $('list').innerHTML=rows.length?`<div class="list-view"><table class="tournament-table"><thead><tr><th>Date</th><th>Tournament</th><th>Mode</th><th>Type</th><th>Category</th><th>Format</th><th>Position</th><th>Prize</th><th>Net</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${esc(t.date)}</td><td><button class="clickable-name" onclick="showTournament('${t.id}')">${esc(t.name)}</button></td><td>${esc(t.mode||'Offline')}</td><td>${esc(t.tournament_type||'')}</td><td>${esc(cat(t))}</td><td>${esc(t.format||'')}</td><td>${t.position?t.position:'—'}</td><td>${money(t.prize)}</td><td><b class="${net(t)>=0?'positive':'negative'}">${net(t)>=0?'+':'-'}${money(Math.abs(net(t)))}</b></td></tr>`).join('')}</tbody></table></div>`:'';
 }else{
   $('list').innerHTML=rows.map(t=>`<div class="row"><div><h3>🏆 ${esc(t.name)}</h3><div class="meta">${esc(t.date)}${t.location?' • '+esc(t.location):''}</div><div class="meta">${esc(t.mode||'Offline')} • ${esc(t.tournament_type||'')} • ${esc(cat(t))} • ${esc(t.format||'')}${t.participants?' • '+t.participants+' participants':''}${t.position?' • '+t.position+'th place':''}${t.score?' • '+esc(t.score):''}</div><div class="actions"><button onclick="showTournament('${t.id}')">Details</button><button onclick="editT('${t.id}')">Edit</button><button onclick="delT('${t.id}')">Delete</button></div></div><div><b class="${net(t)>=0?'positive':'negative'}">${net(t)>=0?'+':'-'}${money(Math.abs(net(t)))}</b><div class="meta">Prize ${money(t.prize)}<br>Spent ${money(expenseTotal(t))}</div></div></div>`).join('');
 }
buildExpenseIncomeYearFilter('expenseYear',$('expenseYear')?.value||'all');
buildExpenseIncomeYearFilter('incomeYear',$('incomeYear')?.value||'all');

renderExpenseIncomeDashboard();

let eq=$('expenseSearch').value.toLowerCase();
let selectedExpenseYear=$('expenseYear').value||'all';

let erows=expenses.filter(e=>
  (selectedExpenseYear==='all'||yearOf(e.date)===selectedExpenseYear) &&
  (e.description+' '+e.category+' '+(e.notes||''))
    .toLowerCase()
    .includes(eq)
);

$('expenseEmpty').style.display=erows.length?'none':'block';
renderExpenseList(erows);

let iq=$('incomeSearch').value.toLowerCase();
let selectedIncomeYear=$('incomeYear').value||'all';

let irows=incomes.filter(e=>
  (selectedIncomeYear==='all'||yearOf(e.date)===selectedIncomeYear) &&
  (e.description+' '+e.category+' '+(e.notes||''))
    .toLowerCase()
    .includes(iq)
);

$('incomeEmpty').style.display=irows.length?'none':'block';
renderIncomeList(irows);
}
 
 renderDashboard();
 renderPerformance();

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
      ${item('Total Tournament Expenses',money(expenseTotal(t)))}
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
function openTournament(t){clearModalRequired();mode='tournament';edit=t||null;$('title').textContent=t?'Edit Tournament':'Add Tournament';$('tournamentFields').classList.remove('hidden');$('expenseFields').classList.add('hidden');$('incomeFields').classList.add('hidden');$('expenseDescription').required=false;$('expenseAmount').required=false;let fields={id:'id',name:'name',date:'date',location:'location',organizer:'organizer',mode:'mode',tournamentType:'tournament_type',ratingCategory:'rating_category',customCategory:'custom_category',format:'format',participants:'participants',rounds:'rounds',time:'time_control',rating:'rating',position:'position',score:'score',performance:'performance',prizeInput:'prize',registration:'registration',travel:'travel',food:'food',accommodation:'accommodation',other:'other',notes:'notes'};for(const [id,key] of Object.entries(fields))$(id).value=t?(t[key]??''):'';if(t&&t.date){const parts=t.date.split('-');if(parts.length===3)$('date').value=`${parts[2]}-${parts[1]}-${parts[0]}`;}if(!t){$('date').value='';$('tournamentType').value='Open';$('ratingCategory').value='Open';$('format').value='Classical';$('mode').value='Offline';['prizeInput','registration','travel','food','accommodation','other'].forEach(id=>$(id).value=0)}calc();$('modal').classList.remove('hidden')}
function openIncome(e){clearModalRequired();mode='income';edit=e||null;$('title').textContent=e?'Edit Chess Income':'Add Chess Income';$('tournamentFields').classList.add('hidden');$('expenseFields').classList.add('hidden');$('incomeFields').classList.remove('hidden');$('expenseDescription').required=false;$('expenseAmount').required=false;$('incomeDescription').required=true;$('incomeAmount').required=true;$('incomeDate').value='';
  if(e?.date){
    const parts=e.date.split('-');
    if(parts.length===3)$('incomeDate').value=`${parts[2]}-${parts[1]}-${parts[0]}`;
  }$('incomeCategory').value=e?.category||'Coaching / Training';$('incomeDescription').value=e?.description||'';$('incomeAmount').value=e?.amount??'';$('incomeNotes').value=e?.notes||'';$('modal').classList.remove('hidden')}
function openExpense(e){clearModalRequired();mode='expense';edit=e||null;$('title').textContent=e?'Edit Other Expense':'Add Other Expense';$('tournamentFields').classList.add('hidden');$('expenseFields').classList.remove('hidden');$('incomeFields').classList.add('hidden');$('expenseDescription').required=true;$('expenseAmount').required=true;$('id').value=e?.id||'';$('expenseDate').value='';
  if(e?.date){
    const parts=e.date.split('-');
    if(parts.length===3)$('expenseDate').value=`${parts[2]}-${parts[1]}-${parts[0]}`;
  }$('expenseCategory').value=e?.category||'Chess Books';$('expenseDescription').value=e?.description||'';$('expenseAmount').value=e?.amount??'';$('expenseNotes').value=e?.notes||'';$('modal').classList.remove('hidden')}
function close(){$('modal').classList.add('hidden')}
window.editT=id=>openTournament(data.find(t=>t.id===id));window.editE=id=>openExpense(expenses.find(e=>e.id===id));window.editI=id=>openIncome(incomes.find(e=>e.id===id));
window.delT=async id=>{if(confirm('Delete this tournament?')){await db.execute('DELETE FROM tournaments WHERE id=?',[id]);await load()}};
window.delE=async id=>{if(confirm('Delete this chess expense?')){await db.execute('DELETE FROM chess_expenses WHERE id=?',[id]);await load()}};window.delI=async id=>{if(confirm('Delete this chess income?')){await db.execute('DELETE FROM chess_income WHERE id=?',[id]);await load()}};
$('date').addEventListener('input',()=>{
  let v=$('date').value.replace(/\D/g,'').slice(0,8);

  if(v.length>4){
    v=v.slice(0,2)+'-'+v.slice(2,4)+'-'+v.slice(4);
  }else if(v.length>2){
    v=v.slice(0,2)+'-'+v.slice(2);
  }

  $('date').value=v;
});

$('eventDate').addEventListener('input',()=>{
  let v=$('eventDate').value.replace(/\D/g,'').slice(0,8);

  if(v.length>4){
    v=v.slice(0,2)+'-'+v.slice(2,4)+'-'+v.slice(4);
  }else if(v.length>2){
    v=v.slice(0,2)+'-'+v.slice(2);
  }

  $('eventDate').value=v;
});

$('eventDeadline').addEventListener('input',()=>{
  let v=$('eventDeadline').value.replace(/\D/g,'').slice(0,8);
  if(v.length>4)v=v.slice(0,2)+'-'+v.slice(2,4)+'-'+v.slice(4);
  else if(v.length>2)v=v.slice(0,2)+'-'+v.slice(2);
  $('eventDeadline').value=v;
});

$('incomeDate').addEventListener('input',()=>{
  let v=$('incomeDate').value.replace(/\D/g,'').slice(0,8);
  if(v.length>4)v=v.slice(0,2)+'-'+v.slice(2,4)+'-'+v.slice(4);
  else if(v.length>2)v=v.slice(0,2)+'-'+v.slice(2);
  $('incomeDate').value=v;
});

$('expenseDate').addEventListener('input',()=>{
  let v=$('expenseDate').value.replace(/\D/g,'').slice(0,8);
  if(v.length>4)v=v.slice(0,2)+'-'+v.slice(2,4)+'-'+v.slice(4);
  else if(v.length>2)v=v.slice(0,2)+'-'+v.slice(2);
  $('expenseDate').value=v;
});

function calc(){let e=['registration','travel','food','accommodation','other'].reduce((s,id)=>s+Number($(id).value||0),0),n=Number($('prizeInput').value||0)-e;$('total').textContent=money(e);$('result').textContent=(n>=0?'+':'-')+money(Math.abs(n));$('result').className=n>=0?'positive':'negative'}
$('addBtn').onclick=()=>openTournament();$('addExpenseBtn').onclick=()=>openExpense();$('addIncomeBtn').onclick=()=>openIncome();$('close').onclick=close;$('cancel').onclick=close;$('search').oninput=render;$('filterMode').onchange=render;$('filterType').onchange=render;$('filterFormat').onchange=render;$('filterCategory').onchange=render;$('filterYear').onchange=render;$('clearFiltersBtn').onclick=()=>{$('search').value='';$('filterMode').value='all';$('filterType').value='all';$('filterFormat').value='all';$('filterCategory').value='all';$('filterYear').value='all';render();}; $('filterFormat').onchange=render;$('filterCategory').onchange=render;$('filterYear').onchange=render; $('filterType').onchange=render; $('expenseSearch').oninput=render;$('incomeSearch').oninput=render;
$('expenseYear').onchange=render;
$('incomeYear').onchange=render;

$('expenseCardViewBtn').onclick=()=>{
  window.expenseView='card';
  $('expenseCardViewBtn').classList.add('active');
  $('expenseListViewBtn').classList.remove('active');
  render();
};

$('expenseListViewBtn').onclick=()=>{
  window.expenseView='list';
  $('expenseListViewBtn').classList.add('active');
  $('expenseCardViewBtn').classList.remove('active');
  render();
};

$('incomeCardViewBtn').onclick=()=>{
  window.incomeView='card';
  $('incomeCardViewBtn').classList.add('active');
  $('incomeListViewBtn').classList.remove('active');
  render();
};

$('incomeListViewBtn').onclick=()=>{
  window.incomeView='list';
  $('incomeListViewBtn').classList.add('active');
  $('incomeCardViewBtn').classList.remove('active');
  render();
};
['registration','travel','food','accommodation','other','prizeInput'].forEach(id=>$(id).oninput=calc);
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');let tab=btn.dataset.tab;$('dashboardSection').classList.toggle('hidden',tab!=='dashboard');$('tournamentSection').classList.toggle('hidden',tab!=='tournaments');$('expenseSection').classList.toggle('hidden',tab!=='expenses');$('incomeSection').classList.toggle('hidden',tab!=='income');$('performanceSection').classList.toggle('hidden',tab!=='performance');$('calendarSection').classList.toggle('hidden',tab!=='calendar');$('settingsSection').classList.toggle('hidden',tab!=='settings');if(tab==='dashboard')renderDashboard();if(tab==='performance')renderPerformance();if(tab==='calendar')renderCalendar()});
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

function parseTournamentDate(value){
  const m=value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if(!m)return null;

  const day=Number(m[1]);
  const month=Number(m[2]);
  const year=Number(m[3]);

  if(month<1||month>12||day<1||day>31||year<1)return null;

  const d=new Date(year,month-1,day);
  if(d.getFullYear()!==year||d.getMonth()!==month-1||d.getDate()!==day)return null;

  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

$('form').onsubmit=async e=>{e.preventDefault();try{if(mode==='expense'){const id=edit?.id||newId(),date=parseTournamentDate($('expenseDate').value.trim()),description=$('expenseDescription').value.trim(),amount=Number($('expenseAmount').value);if(!date||!description||!(amount>0)){alert('Please enter Date, Description and a valid Amount.');return}const x=[id,date,$('expenseCategory').value,description,amount,$('expenseNotes').value.trim()];if(edit)await db.execute('UPDATE chess_expenses SET date=?,category=?,description=?,amount=?,notes=? WHERE id=?',[x[1],x[2],x[3],x[4],x[5],id]);else await db.execute('INSERT INTO chess_expenses (id,date,category,description,amount,notes) VALUES (?,?,?,?,?,?)',x);close();await load();return}
if(mode==='income'){const id=edit?.id||newId(),date=parseTournamentDate($('incomeDate').value.trim()),description=$('incomeDescription').value.trim(),amount=Number($('incomeAmount').value);if(!date||!description||!(amount>0)){alert('Please enter Date, Description and a valid Amount.');return}const x=[id,date,$('incomeCategory').value,description,amount,$('incomeNotes').value.trim()];if(edit)await db.execute('UPDATE chess_income SET date=?,category=?,description=?,amount=?,notes=? WHERE id=?',[x[1],x[2],x[3],x[4],x[5],id]);else await db.execute('INSERT INTO chess_income (id,date,category,description,amount,notes) VALUES (?,?,?,?,?,?)',x);close();await load();return}
const id=edit?.id||newId();const tournamentDate=parseTournamentDate($('date').value.trim());if(!tournamentDate){alert('Please enter a valid date in DD-MM-YYYY format.');return}const vals={name:$('name').value.trim(),date:tournamentDate,location:$('location').value.trim(),organizer:$('organizer').value.trim(),mode:$('mode').value,tournament_type:$('tournamentType').value,rating_category:$('ratingCategory').value,custom_category:$('customCategory').value.trim(),format:$('format').value,participants:Number($('participants').value||0),rounds:Number($('rounds').value||0),time_control:$('time').value.trim(),rating:Number($('rating').value||0),position:Number($('position').value||0),score:$('score').value.trim(),performance:Number($('performance').value||0),prize:Number($('prizeInput').value||0),registration:Number($('registration').value||0),travel:Number($('travel').value||0),food:Number($('food').value||0),accommodation:Number($('accommodation').value||0),other:Number($('other').value||0),notes:$('notes').value.trim()};if(!vals.name||!vals.date){alert('Please enter tournament name and date.');return}const p=[vals.name,vals.date,vals.location,vals.organizer,vals.tournament_type,vals.rating_category,vals.custom_category,vals.format,vals.participants,vals.rounds,vals.time_control,vals.rating,vals.position,vals.score,vals.performance,vals.prize,vals.registration,vals.travel,vals.food,vals.accommodation,vals.other,vals.notes];if(edit)await db.execute(`UPDATE tournaments SET name=?,date=?,location=?,organizer=?,mode=?,tournament_type=?,rating_category=?,custom_category=?,format=?,participants=?,rounds=?,time_control=?,rating=?,position=?,score=?,performance=?,prize=?,registration=?,travel=?,food=?,accommodation=?,other=?,notes=? WHERE id=?`,[vals.name,vals.date,vals.location,vals.organizer,vals.mode,...p.slice(4),id]);else await db.execute(`INSERT INTO tournaments (id,name,date,location,organizer,mode,tournament_type,rating_category,custom_category,format,participants,rounds,time_control,rating,position,score,performance,prize,registration,travel,food,accommodation,other,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,vals.name,vals.date,vals.location,vals.organizer,vals.mode,...p.slice(4)]);

if(window.convertingEventId){
  await db.execute('DELETE FROM events WHERE id=?',[window.convertingEventId]);
  window.convertingEventId=null;
}

close();
await load();
renderCalendar();
}catch(err){console.error(err);alert('Could not save. '+err)} };
async function backup(){
  try{
    const payload={
      version:5,
      exportedAt:new Date().toISOString(),
      tournaments:data,
      expenses,
      incomes,
      events
    };

    const path=await save({
      defaultPath:'chess-ledger-backup.json',
      filters:[{name:'Chess Ledger Backup',extensions:['json']}]
    });

    if(!path)return;

    await writeTextFile(path,JSON.stringify(payload,null,2));
    alert('Backup saved successfully.');
  }catch(err){
    console.error(err);
    alert('Could not create backup: '+(err?.message||String(err)));
  }
}

$('settingsBackupBtn').onclick=backup;
$('settingsRestoreBtn').onclick=()=>$('restoreFile').click();

$('settingsClearBtn').onclick=async()=>{
  const first=await dialogConfirm(
    'This will permanently delete all tournaments, other expenses, other income and calendar events.\n\nThis action cannot be undone.',
    {
      title:'⚠️ Clear All Data?',
      kind:'warning'
    }
  );

  if(!first){
    return;
  }

  const second=await dialogConfirm(
    'All Chess Ledger records will be permanently deleted.',
    {
      title:'Are you absolutely sure?',
      kind:'warning'
    }
  );

  if(!second){
    return;
  }

  try{
    await db.execute('DELETE FROM tournaments');
    await db.execute('DELETE FROM chess_expenses');
    await db.execute('DELETE FROM chess_income');
    await db.execute('DELETE FROM events');

    await load();
    renderCalendar();

    alert('All Chess Ledger data has been cleared.');
  }catch(err){
    console.error(err);
    alert('Could not clear data: '+(err?.message||String(err)));
  }
};

$('restoreFile').onchange=async()=>{
  const f=$('restoreFile').files[0];
  if(!f)return;

  try{
    const p=JSON.parse(await f.text());

    if(!Array.isArray(p.tournaments)||
       !Array.isArray(p.expenses)||
       !Array.isArray(p.incomes)){
      throw new Error('Invalid Chess Ledger backup file.');
    }

    if(!Array.isArray(p.events)){
      p.events=[];
    }

    if(!confirm(
      'Restore backup?\\n\\n' +
      'Existing Chess Ledger data will be replaced by the backup.'
    )){
      return;
    }

    await db.execute('DELETE FROM tournaments');
    await db.execute('DELETE FROM chess_expenses');
    await db.execute('DELETE FROM chess_income');
    await db.execute('DELETE FROM events');

    for(const t of p.tournaments){
      await db.execute(`
        INSERT INTO tournaments
        (id,name,date,location,organizer,mode,tournament_type,
         rating_category,custom_category,format,participants,rounds,
         time_control,rating,position,score,performance,prize,
         registration,travel,food,accommodation,other,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,[
        t.id||newId(),
        t.name||'',
        t.date||today(),
        t.location||'',
        t.organizer||'',
        t.mode||'Offline',
        t.tournament_type||t.tournamentType||'Open',
        t.rating_category||t.ratingCategory||'Open',
        t.custom_category||t.customCategory||'',
        t.format||'Classical',
        Number(t.participants||0),
        Number(t.rounds||0),
        t.time_control||t.time||'',
        Number(t.rating||0),
        Number(t.position||0),
        t.score||'',
        Number(t.performance||0),
        Number(t.prize||0),
        Number(t.registration||0),
        Number(t.travel||0),
        Number(t.food||0),
        Number(t.accommodation||0),
        Number(t.other||0),
        t.notes||''
      ]);
    }

    for(const x of p.expenses){
      await db.execute(`
        INSERT INTO chess_expenses
        (id,date,category,description,amount,notes)
        VALUES (?,?,?,?,?,?)
      `,[
        x.id||newId(),
        x.date||today(),
        x.category||'Other Expense',
        x.description||'Expense',
        Number(x.amount||0),
        x.notes||''
      ]);
    }

    for(const x of p.incomes){
      await db.execute(`
        INSERT INTO chess_income
        (id,date,category,description,amount,notes)
        VALUES (?,?,?,?,?,?)
      `,[
        x.id||newId(),
        x.date||today(),
        x.category||'Other Income',
        x.description||'Income',
        Number(x.amount||0),
        x.notes||''
      ]);
    }

    for(const e of p.events){
      await db.execute(`
        INSERT INTO events
        (id,name,date,location,organizer,mode,format,deadline,reminder,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `,[
        e.id||newId(),
        e.name||'',
        e.date||today(),
        e.location||'',
        e.organizer||'',
        e.mode||'Offline',
        e.format||'Classical',
        e.deadline||'',
        Number(e.reminder??-1),
        e.notes||''
      ]);
    }

    await load();
    renderCalendar();

    alert('Backup restored successfully.');
  }catch(err){
    console.error(err);
    alert('Could not restore backup: '+(err?.message||String(err)));
  }

  $('restoreFile').value='';
};

setupCurrency();
init().then(()=>{
  document.querySelector('.tab[data-tab="dashboard"]').click();
  recordUsage();
}).catch(err=>{console.error(err);document.body.insertAdjacentHTML('afterbegin','<div style="padding:12px;background:#fee;color:#900">Database could not be opened. Please run the Tauri app, not index.html directly.</div>')});
['participants','rounds','position','score'].forEach(id=>{
  $(id).addEventListener('input',calculateTPS);
});
