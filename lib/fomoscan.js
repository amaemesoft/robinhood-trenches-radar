'use strict';

const EVM=/^0x[a-fA-F0-9]{40}$/;

function normalizeIdentity(row={}){
  const evmAddress=EVM.test(row.evmAddress||'')?String(row.evmAddress).toLowerCase():null;
  return{
    id:row.id?String(row.id):null,
    handle:row.handle?String(row.handle).replace(/^@/,''):null,
    evmAddress
  };
}

function thesisItems(payload){
  if(Array.isArray(payload))return payload;
  for(const key of ['items','theses','data','results'])if(Array.isArray(payload?.[key]))return payload[key];
  return[];
}

function normalizeThesis(row={}){
  const id=row.id??row.thesisId;
  const authorId=row.authorId??row.author?.id??row.userId??row.user?.id;
  const candidate=row.tokenAddress??row.token?.address??row.contractAddress??row.token?.contractAddress;
  if(id==null||authorId==null||!EVM.test(String(candidate||'')))return null;
  return{
    id:String(id),
    authorId:String(authorId),
    tokenAddress:String(candidate).toLowerCase(),
    at:row.createdAt??row.publishedAt??row.timestamp??row.at??null,
    text:String(row.thesis??row.content??row.text??row.body??'').slice(0,1000),
    rawChainId:row.chainId??row.chain?.id??row.networkId??null,
    rawChain:row.chain?.name??row.chain??row.network??null
  };
}

class FomoScanClient{
  constructor({apiKey='',baseUrl='https://api.fomoscan.sh'}={}){
    this.apiKey=apiKey;
    this.baseUrl=String(baseUrl||'https://api.fomoscan.sh').replace(/\/$/,'');
  }
  enabled(){return !!this.apiKey;}
  async request(path){
    if(!this.enabled())throw new Error('fomoscan api key not configured');
    const response=await fetch(`${this.baseUrl}${path}`,{
      headers:{authorization:`Bearer ${this.apiKey}`,accept:'application/json'},
      signal:AbortSignal.timeout(12000)
    });
    if(!response.ok)throw new Error(`fomoscan HTTP ${response.status}`);
    return response.json();
  }
  async resolveHandle(handle){
    const clean=String(handle||'').replace(/^@/,'').trim();
    if(!clean)return null;
    const payload=await this.request(`/v2/user/handle/${encodeURIComponent(clean)}`);
    return normalizeIdentity(payload);
  }
  async latestTheses(){
    const payload=await this.request('/v2/thesis');
    return thesisItems(payload).map(normalizeThesis).filter(Boolean);
  }
}

module.exports={FomoScanClient,normalizeIdentity,thesisItems,normalizeThesis,EVM};
