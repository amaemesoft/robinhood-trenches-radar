'use strict';

const TOKEN_NAME_CACHE=new Map();
const TOKEN_NAME_TTL_MS=10*60*1000;

function tokenAddressFromCard(card){
  const code=card?.querySelector('.technical code');
  const value=String(code?.textContent||'').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(value)?value:null;
}

function tokenNameTarget(card){
  if(card?.classList.contains('signal-card'))return card.querySelector('.token');
  if(card?.classList.contains('observation'))return card.querySelector(':scope > div > b');
  return null;
}

function cleanTicker(value){
  return String(value||'').trim().replace(/^\$/,'');
}

function tokenLabel(name,symbol,fallback){
  const cleanName=String(name||'').trim();
  const ticker=cleanTicker(symbol);
  if(cleanName&&ticker)return `${cleanName} ($${ticker})`;
  if(cleanName)return cleanName;
  if(ticker)return `$${ticker}`;
  return cleanTicker(fallback)||'TOKEN';
}

async function fetchTokenName(address){
  const cached=TOKEN_NAME_CACHE.get(address);
  if(cached&&Date.now()-cached.at<TOKEN_NAME_TTL_MS)return cached.value;
  let value=null;
  try{
    const response=await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${address}`,{
      headers:{accept:'application/json'},cache:'no-store'
    });
    if(response.ok){
      const rows=await response.json();
      const pairs=(Array.isArray(rows)?rows:[])
        .filter(pair=>pair?.chainId==='robinhood'&&String(pair?.baseToken?.address||'').toLowerCase()===address)
        .sort((a,b)=>Number(b?.liquidity?.usd||0)-Number(a?.liquidity?.usd||0));
      const token=pairs[0]?.baseToken;
      const name=String(token?.name||'').trim();
      const symbol=cleanTicker(token?.symbol);
      if(name||symbol)value={name:name||null,symbol:symbol||null};
    }
  }catch{}
  TOKEN_NAME_CACHE.set(address,{at:Date.now(),value});
  return value;
}

async function enrichTokenCard(card){
  const address=tokenAddressFromCard(card);
  const target=tokenNameTarget(card);
  if(!address||!target)return;
  if(target.dataset.tokenNameAddress===address)return;
  target.dataset.tokenNameAddress=address;
  const fallback=target.textContent;
  const meta=await fetchTokenName(address);
  if(!meta)return;
  target.textContent=tokenLabel(meta.name,meta.symbol,fallback);
  target.title=address;
}

function enrichVisibleTokenNames(root=document){
  const cards=root.matches?.('.signal-card,.observation')?[root]:[...root.querySelectorAll?.('.signal-card,.observation')||[]];
  for(const card of cards)enrichTokenCard(card);
}

const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations){
    for(const node of mutation.addedNodes){
      if(node.nodeType===1)enrichVisibleTokenNames(node);
    }
  }
});

function startTokenNameEnrichment(){
  const signals=document.querySelector('#signals');
  const observations=document.querySelector('#observations');
  if(signals)observer.observe(signals,{childList:true,subtree:true});
  if(observations)observer.observe(observations,{childList:true,subtree:true});
  enrichVisibleTokenNames(document);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startTokenNameEnrichment,{once:true});
else startTokenNameEnrichment();
