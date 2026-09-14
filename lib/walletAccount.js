'use strict';

const ROBINHOOD_CHAIN_ID=4663;
const ADDRESS_PATTERN=/^0x[a-fA-F0-9]{40}$/;
const HEX_PATTERN=/^0x[0-9a-fA-F]+$/;

function normalizeAddress(value){
  const address=String(value||'').trim();
  return ADDRESS_PATTERN.test(address)?address.toLowerCase():null;
}

function parseChainId(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string'||!value.trim())return null;
  const parsed=Number.parseInt(value,value.toLowerCase().startsWith('0x')?16:10);
  return Number.isFinite(parsed)?parsed:null;
}

async function readWalletAccount({rpc,address}){
  const normalized=normalizeAddress(address);
  if(!normalized){
    const error=new Error('invalid EVM address');
    error.code='INVALID_ADDRESS';
    throw error;
  }
  if(typeof rpc!=='function')throw new Error('rpc function required');

  const [chainRaw,balance]=await Promise.all([
    rpc('eth_chainId'),
    rpc('eth_getBalance',[normalized,'latest'])
  ]);
  const chainId=parseChainId(chainRaw);
  if(chainId!==ROBINHOOD_CHAIN_ID){
    const error=new Error(`unexpected chain ${chainId??'unknown'}`);
    error.code='WRONG_CHAIN';
    throw error;
  }
  if(typeof balance!=='string'||!HEX_PATTERN.test(balance)){
    const error=new Error('invalid balance returned by RPC');
    error.code='INVALID_RPC_RESPONSE';
    throw error;
  }
  return{address:normalized,chainId,balance,mode:'WATCH_ONLY'};
}

module.exports={ROBINHOOD_CHAIN_ID,normalizeAddress,parseChainId,readWalletAccount};
