'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=file=>fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');

test('the product opens in NOW and keeps DISCOVER and DESK as separate views',()=>{
  const html=read('index.html');
  assert.match(html,/class="view-panel is-active" data-view-panel="now"/);
  assert.match(html,/data-view-panel="discover"[^>]*hidden/);
  assert.match(html,/data-view-panel="desk"[^>]*hidden/);
  assert.doesNotMatch(html,/ÚLTIMO BRIEFING MULTIAGENTE|VECTOR · SETUPS|LEDGER · PAPER/);
});

test('the desk compresses internal agents into five user-facing gates',()=>{
  const js=read('autopilot.js');
  for(const gate of ['SEÑAL','MERCADO','SEGURIDAD','TIMING','RIESGO'])assert.match(js,new RegExp(`'${gate}'`));
  assert.match(js,/trenches:viewchange/);
  assert.match(js,/clearInterval\(refreshTimer\)/);
});

test('cycle and desk endpoints load lazily only after their view opens',()=>{
  assert.match(read('cycle.js'),/event\.detail\?\.view==='discover'/);
  assert.match(read('autopilot.js'),/event\.detail\?\.view==='desk'/);
  assert.match(read('cycle.js'),/clearInterval\(refreshTimer\)/);
});
