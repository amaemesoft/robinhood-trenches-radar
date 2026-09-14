'use strict';

(()=>{
  const CHAIN_ID_HEX='0x1237';
  const CHAIN_ID_DECIMAL=4663;
  const $=selector=>document.querySelector(selector);
  const status=$('#walletStatus');
  const button=$('#walletConnect');
  const mode=$('#walletMode');
  const watchForm=$('#walletWatchForm');
  const watchInput=$('#walletWatchAddress');
  const watchButton=$('#walletWatch');
  let boundProvider=null;
  let announcedProvider=null;

  const isPhantom=provider=>!!provider&&provider.isPhantom===true;
  const ethereum=()=>{
    if(window.phantom?.ethereum)return window.phantom.ethereum;
    if(announcedProvider)return announcedProvider;
    const providers=Array.isArray(window.ethereum?.providers)?window.ethereum.providers:[];
    return providers.find(isPhantom)||(isPhantom(window.ethereum)?window.ethereum:null);
  };
  const isEmbedded=()=>{try{return window.self!==window.top}catch{return true}};
  const normalizeChain=value=>{
    if(typeof value==='number')return value;
    if(typeof value!=='string')return null;
    const parsed=Number.parseInt(value,value.startsWith('0x')?16:10);
    return Number.isFinite(parsed)?parsed:null;
  };
  const shortAddress=value=>/^0x[a-fA-F0-9]{40}$/.test(value||'')?`${value.slice(0,6)}…${value.slice(-4)}`:'—';
  const formatWei=value=>{
    try{
      const wei=BigInt(value||'0x0');
      const whole=wei/10n**18n;
      const fraction=(wei%10n**18n).toString().padStart(18,'0').slice(0,5).replace(/0+$/,'');
      return `${whole}${fraction?`.${fraction}`:''} ETH`;
    }catch{return'—';}
  };

  function render({state='No conectada',address=null,chainId=CHAIN_ID_DECIMAL,balance=null,error=false,notice=null,modeText=null}={}){
    if($('#walletState'))$('#walletState').textContent=state;
    if($('#walletAddress')){
      $('#walletAddress').textContent=shortAddress(address);
      $('#walletAddress').title=address||'';
    }
    if($('#walletNetwork'))$('#walletNetwork').textContent=chainId===CHAIN_ID_DECIMAL?'Robinhood Chain · 4663':chainId?`Red incorrecta · ${chainId}`:'Red no detectada';
    if($('#walletBalance'))$('#walletBalance').textContent=balance==null?'—':formatWei(balance);
    status?.classList.toggle('is-connected',state==='Conectada'||state==='Solo lectura');
    status?.classList.toggle('is-error',error);
    if($('#walletNotice')&&notice)$('#walletNotice').textContent=notice;
    if(button)button.textContent=state==='Conectada'?'Actualizar cuenta':'Conectar Phantom';
    if(mode)mode.textContent=modeText||(state==='Conectada'?'PHANTOM VERIFICADA · SIN TRADING':state==='Solo lectura'?'SOLO LECTURA · SIN FIRMA':'SIN PERMISO DE TRADING');
  }

  async function switchToRobinhood(provider){
    const current=await provider.request({method:'eth_chainId'});
    if(normalizeChain(current)===CHAIN_ID_DECIMAL)return;
    await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_ID_HEX}]});
    const switched=await provider.request({method:'eth_chainId'});
    if(normalizeChain(switched)!==CHAIN_ID_DECIMAL)throw new Error('Phantom no cambió a Robinhood Chain');
  }

  async function refresh({prompt=false}={}){
    const provider=ethereum();
    if(!provider){
      const notice=isEmbedded()
        ?'Phantom no se inyecta dentro de este visor. Abre Trenches fuera del visor para conectar, o pega debajo tu dirección pública para consultar la cuenta sin firma. Trenches nunca te pedirá la seed phrase.'
        :'Phantom no está disponible en este navegador. Abre Trenches en el navegador de Phantom o instala su extensión; también puedes consultar abajo una dirección pública. Trenches nunca te pedirá la seed phrase.';
      render({state:'Phantom no detectada',error:true,notice});
      return;
    }
    if(button)button.disabled=true;
    try{
      const method=prompt?'eth_requestAccounts':'eth_accounts';
      const accounts=await provider.request({method});
      const address=Array.isArray(accounts)?accounts[0]:null;
      if(!address){
        render({state:'No conectada',notice:'Pulsa Conectar Phantom. La conexión requiere una acción explícita en tu wallet.'});
        return;
      }
      await switchToRobinhood(provider);
      const [chain,balance]=await Promise.all([
        provider.request({method:'eth_chainId'}),
        provider.request({method:'eth_getBalance',params:[address,'latest']})
      ]);
      render({state:'Conectada',address,chainId:normalizeChain(chain),balance,notice:'Conexión verificada en Robinhood Chain. Modo actual: lectura local, sin firma ni envío de transacciones.'});
      if(watchInput)watchInput.value=address;
      bind(provider);
    }catch(error){
      const rejected=Number(error?.code)===4001;
      render({state:rejected?'Conexión cancelada':'Revisión necesaria',error:true,notice:rejected?'Phantom no concedió acceso. No se ha realizado ninguna acción.':`No se pudo validar Robinhood Chain: ${error?.message||'error desconocido'}`});
    }finally{
      if(button)button.disabled=false;
    }
  }

  async function watchAddress(value,{persist=true}={}){
    const address=String(value||'').trim();
    if(!/^0x[a-fA-F0-9]{40}$/.test(address)){
      render({state:'Dirección inválida',error:true,notice:'Pega una dirección EVM completa: 0x seguida de 40 caracteres hexadecimales. No pegues una seed phrase ni una clave privada.'});
      return;
    }
    if(watchButton)watchButton.disabled=true;
    try{
      const response=await fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`,{cache:'no-store'});
      let payload={};
      try{payload=await response.json()}catch{}
      if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
      render({state:'Solo lectura',address:payload.address||address,chainId:normalizeChain(payload.chainId),balance:payload.balance,notice:'Cuenta encontrada en Robinhood Chain. Puedes ver su gas, pero esta dirección pública no permite firmar, comprar, vender ni mover fondos.',modeText:'SOLO LECTURA · SIN FIRMA'});
      if(watchInput)watchInput.value=payload.address||address;
      if(persist)try{window.localStorage?.setItem('trenches:watchAddress',payload.address||address)}catch{}
    }catch(error){
      render({state:'Consulta no disponible',error:true,notice:`No se pudo leer la cuenta en Robinhood Chain: ${error?.message||'error desconocido'}. No se ha solicitado ninguna firma.`});
    }finally{
      if(watchButton)watchButton.disabled=false;
    }
  }

  function bind(provider){
    if(boundProvider===provider||typeof provider?.on!=='function')return;
    boundProvider=provider;
    provider.on('accountsChanged',()=>refresh());
    provider.on('chainChanged',()=>refresh());
    provider.on('disconnect',()=>render({state:'Desconectada',notice:'La wallet se ha desconectado. No se ha realizado ninguna transacción.'}));
  }

  window.addEventListener?.('eip6963:announceProvider',event=>{
    const provider=event?.detail?.provider;
    if(isPhantom(provider))announcedProvider=provider;
  });
  if(typeof window.Event==='function')window.dispatchEvent?.(new window.Event('eip6963:requestProvider'));

  button?.addEventListener('click',()=>refresh({prompt:true}));
  watchForm?.addEventListener('submit',event=>{event.preventDefault();watchAddress(watchInput?.value)});
  document.addEventListener('trenches:viewchange',event=>{
    if(event.detail?.view==='desk')refresh();
  });
  try{
    const saved=window.localStorage?.getItem('trenches:watchAddress');
    if(watchInput&&/^0x[a-fA-F0-9]{40}$/.test(saved||''))watchInput.value=saved;
  }catch{}
  const desk=document.querySelector('[data-view-panel="desk"]');
  if(desk&&!desk.hidden)refresh();
})();
