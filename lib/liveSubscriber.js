'use strict';

const WebSocket=require('ws');
const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const lower=a=>String(a||'').toLowerCase();
const topic=a=>'0x'+'0'.repeat(24)+lower(a).replace(/^0x/,'');

class LiveSubscriber{
  constructor({wsUrl,getWallets,onTx,onStatus}){
    this.wsUrl=wsUrl;
    this.getWallets=getWallets;
    this.onTx=onTx;
    this.onStatus=onStatus||(()=>{});
    this.ws=null;
    this.stopped=false;
    this.retry=1000;
    this.timer=null;
    this.pingTimer=null;
    this.seen=new Map();
  }

  status(state,extra={}){
    try{this.onStatus({state,at:new Date().toISOString(),...extra});}catch{}
  }

  start(){
    this.stopped=false;
    this.connect();
  }

  stop(){
    this.stopped=true;
    clearTimeout(this.timer);
    clearInterval(this.pingTimer);
    try{this.ws?.close();}catch{}
  }

  connect(){
    if(this.stopped)return;
    const wallets=(this.getWallets?.()||[]).filter(a=>/^0x[a-fA-F0-9]{40}$/.test(a));
    if(!wallets.length){this.status('idle',{reason:'no_wallets'});this.timer=setTimeout(()=>this.connect(),30000);return;}
    const topics=wallets.map(topic);
    this.status('connecting',{wallets:wallets.length});
    const ws=new WebSocket(this.wsUrl,{handshakeTimeout:15000});
    this.ws=ws;

    ws.on('open',()=>{
      this.retry=1000;
      this.status('connected',{wallets:wallets.length});
      ws.send(JSON.stringify({jsonrpc:'2.0',id:101,method:'eth_subscribe',params:['logs',{topics:[TRANSFER_TOPIC,topics]}]}));
      ws.send(JSON.stringify({jsonrpc:'2.0',id:102,method:'eth_subscribe',params:['logs',{topics:[TRANSFER_TOPIC,null,topics]}]}));
      clearInterval(this.pingTimer);
      this.pingTimer=setInterval(()=>{try{if(ws.readyState===WebSocket.OPEN)ws.ping();}catch{}},20000);
    });

    ws.on('message',buf=>{
      let m;try{m=JSON.parse(buf.toString())}catch{return;}
      if(m.id===101||m.id===102){
        if(m.error)this.status('subscription_error',{error:m.error.message||JSON.stringify(m.error)});
        else this.status('subscribed',{subscription:m.result});
        return;
      }
      const hash=m?.params?.result?.transactionHash;
      if(!hash)return;
      const now=Date.now();
      for(const [h,t] of this.seen)if(now-t>10*60*1000)this.seen.delete(h);
      if(this.seen.has(hash))return;
      this.seen.set(hash,now);
      Promise.resolve(this.onTx?.(hash)).catch(e=>this.status('tx_error',{txHash:hash,error:e.message}));
    });

    ws.on('error',e=>this.status('socket_error',{error:e.message}));
    ws.on('close',(code,reason)=>{
      clearInterval(this.pingTimer);
      this.status('disconnected',{code,reason:String(reason||'')});
      if(this.stopped)return;
      const wait=this.retry;this.retry=Math.min(30000,this.retry*2);
      this.timer=setTimeout(()=>this.connect(),wait);
    });
  }
}

module.exports=LiveSubscriber;
