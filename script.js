/* script.js - projeto_variacao_dolar_v3
 Features:
  - Fetch daily series from BCB (SGS 10813) from 01/01/2022 up to today (monthly aggregation)
  - Include Dec/2025 projection (Focus) if missing
  - Auto-update every X (default 6h) and manual 'Atualizar Agora' button
  - Display two stacked charts: upper = Value (R$), lower = Monthly % Variation
  - Selection to compare two months
  - All data is fetched from BCB at runtime; no Excel required
*/

const API_BCB_BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.10813/dados";
const PROJECAO_DEZ_2025 = 5.45; // projeção Focus
const LABELS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

let monthlyData = []; // [{key,label,startValue,endValue,diff,pct,projected?}]
let updateTimer = null;

// helper: format date dd/mm/yyyy from Date
function formatDateDMY(d){
  const day = String(d.getDate()).padStart(2,'0');
  const month = String(d.getMonth()+1).padStart(2,'0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// fetch daily series between dates (inclusive)
async function fetchDaily(fromDate, toDate){
  const url = `${API_BCB_BASE}?formato=json&dataInicial=${fromDate}&dataFinal=${toDate}`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error('BCB API error '+resp.status);
  const data = await resp.json();
  return data.map(r => ({data: r.data, valor: parseFloat(r.valor.replace(',','.'))}));
}

// aggregate daily into months (first and last available day of month)
function aggregateMonthly(daily){
  const groups = {};
  daily.forEach(r => {
    const [d,m,y] = r.data.split('/');
    const key = `${y}-${m.padStart(2,'0')}`;
    if(!groups[key]) groups[key] = [];
    groups[key].push({date: new Date(parseInt(y), parseInt(m)-1, parseInt(d)), valor: r.valor});
  });
  const keys = Object.keys(groups).sort();
  const result = [];
  keys.forEach(k => {
    const arr = groups[k].sort((a,b)=>a.date - b.date);
    const start = arr[0].valor;
    const end = arr[arr.length-1].valor;
    const diff = end - start;
    const pct = (diff / start) * 100;
    result.push({key: k, label: labelFromKey(k), startValue: start, endValue: end, diff, pct});
  });
  return result;
}

function labelFromKey(key){
  const [y,mm] = key.split('-');
  return `${LABELS_PT[parseInt(mm,10)-1]}/${y}`;
}

// ensure coverage Jan/2022 .. Dec/2025, add projection for Dec/2025 if missing
function ensureRange(dataArr){
  // filter >= 2022-01 and <= 2025-12
  let filtered = dataArr.filter(r => r.key >= '2022-01' && r.key <= '2025-12');
  const hasDec = filtered.some(r => r.key === '2025-12');
  if(!hasDec){
    const last = filtered[filtered.length-1];
    const startDec = last ? last.endValue : PROJECAO_DEZ_2025;
    const endDec = PROJECAO_DEZ_2025;
    const diff = endDec - startDec;
    const pct = (diff / startDec) * 100;
    filtered.push({key:'2025-12', label:labelFromKey('2025-12'), startValue:startDec, endValue:endDec, diff, pct, projected:true});
  }
  // sort and return
  filtered.sort((a,b)=> a.key.localeCompare(b.key));
  return filtered;
}

// build arrays for plotting
function buildArrays(){
  const labels = monthlyData.map(m=>m.label);
  const endValues = monthlyData.map(m=>m.endValue);
  const pctValues = monthlyData.map(m=>m.pct);
  return {labels,endValues,pctValues};
}

// plot upper (value) and lower (pct) charts stacked
function plotCharts(){
  const {labels,endValues,pctValues} = buildArrays();
  const traceVal = { x: labels, y: endValues, name: 'Valor final (R$)', type:'scatter', mode:'lines+markers', marker:{size:6}, line:{color:'#1f77b4'} , hovertemplate:"<b>%{x}</b><br>R$ %{y:.2f}<extra></extra>"};
  const layoutVal = { title:{text:'Valor final mensal (R$)', x:0.5}, xaxis:{tickangle:-45}, margin:{t:50,b:80} };
  Plotly.react('grafico_valor',[traceVal], layoutVal, {responsive:true});

  const tracePct = { x: labels, y: pctValues, name:'Variação mensal (%)', type:'scatter', mode:'lines+markers', marker:{size:6}, line:{color:'#2ca02c', dash:'dash'}, hovertemplate:"<b>%{x}</b><br>%{y:.2f}%<extra></extra>"};
  const layoutPct = { title:{text:'Variação percentual mensal (%)', x:0.5}, xaxis:{tickangle:-45}, margin:{t:50,b:80} };
  Plotly.react('grafico_pct',[tracePct], layoutPct, {responsive:true});

  attachClicks();
}

function attachClicks(){
  const g1 = document.getElementById('grafico_valor');
  const g2 = document.getElementById('grafico_pct');
  [g1,g2].forEach(el=>{
    el.on('plotly_click', data=>{
      if(!data || !data.points || data.points.length==0) return;
      const idx = data.points[0].pointIndex;
      const m = monthlyData[idx];
      if(!m) return;
      const projNote = m.projected ? ' (PROJEÇÃO)' : '';
      document.getElementById('detalhes').innerHTML = `<b>${m.label}${projNote}</b><br>Valor inicial: <b>R$ ${m.startValue.toFixed(2)}</b><br>Valor final: <b>R$ ${m.endValue.toFixed(2)}</b><br>Diferença: <b>R$ ${m.diff.toFixed(2)}</b><br>Variação: <b>${m.pct.toFixed(2)}%</b>`;
    });
  });
}

async function updateFromBCB(showStatus=true){
  try{
    if(showStatus) document.getElementById('ultimaAtualizacao').textContent = 'Atualizando...';
    // set date range: from 01/01/2022 to today (dd/mm/yyyy)
    const from = '01/01/2022';
    const today = new Date();
    const to = formatDateDMY(today);
    const daily = await fetchDaily(from,to);
    const aggregated = aggregateMonthly(daily);
    monthlyData = ensureRange(aggregated);
    plotCharts();
    preencherSelects();
    const now = new Date();
    document.getElementById('ultimaAtualizacao').textContent = 'Última atualização: ' + now.toLocaleString();
  }catch(err){
    console.error('Erro updateFromBCB',err);
    document.getElementById('ultimaAtualizacao').textContent = 'Última atualização: erro';
  }
}

function preencherSelects(){
  const s1 = document.getElementById('mes1'), s2 = document.getElementById('mes2');
  s1.innerHTML = ''; s2.innerHTML = '';
  monthlyData.forEach(m=>{
    const o1 = document.createElement('option'); const o2 = document.createElement('option');
    o1.value = o2.value = m.label; o1.text = o2.text = m.label + (m.projected ? ' (PROJ)' : '');
    s1.add(o1); s2.add(o2);
  });
}

function comparar(){
  const m1 = document.getElementById('mes1').value; const m2 = document.getElementById('mes2').value;
  if(!m1 || !m2){ alert('Selecione dois meses'); return; }
  const a = monthlyData.find(x=>x.label===m1); const b = monthlyData.find(x=>x.label===m2);
  if(!a||!b){ alert('Meses não encontrados'); return; }
  const diff = b.endValue - a.endValue; const pct = ((b.endValue / a.endValue -1) *100).toFixed(2);
  document.getElementById('detalhes').innerHTML = `<b>Análise Comparativa</b><br>🔹 ${a.label}: <b>R$ ${a.endValue.toFixed(2)}</b><br>🔹 ${b.label}: <b>R$ ${b.endValue.toFixed(2)}</b><br><br>Diferença: <b>R$ ${diff.toFixed(2)}</b><br>Variação percentual: <b>${pct}%</b>`;
}

// setup auto-update
document.getElementById('btnAtualizarAgora').addEventListener('click', ()=> updateFromBCB(true));
document.getElementById('analisar').addEventListener('click', comparar);
const intervaloSelect = document.getElementById('intervalo');
let intervalo = parseInt(intervaloSelect.value,10) || 21600000;
intervaloSelect.addEventListener('change', ()=>{
  intervalo = parseInt(intervaloSelect.value,10);
  if(updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(()=> updateFromBCB(false), intervalo);
});

updateTimer = setInterval(()=> updateFromBCB(false), intervalo);

// initial load
updateFromBCB(true);
