'use strict';

(()=>{
  const CHAIN_ID_HEX='0x1237';
  const CHAIN_ID_DECIMAL=4663;
  const ACTIONS={
    create:'CREATE_OPERATIONAL_ACCOUNT',session:'REQUEST_LIMITED_SESSION',test:'TEST_AUTONOMOUS_SESSION',
    arm:'ARM_LIMITED_AUTONOMY',stop:'STOP_AND_LIQUIDATE',reclaim:'PREPARE_OWNER_RECLAIM'
  };
  const $=selector=>document.querySelector(selector);
  const status=$('#walletStatus'),connectButton=$('#walletConnect'),mode=$('#walletMode');
  const watchForm=$('#walletWatchForm'),watchInput=$('#walletWatchAddress'),watchButton=$('#walletWatch');
  const controls={create:$('#liveCreate'),fund:$('#liveFund'),authorize:$('#liveAuthorize'),test:$('#liveTest'),arm:$('#liveArm'),stop:$('#liveStop'),reclaim:$('#liveReclaim'),reclaimNative:$('#liveReclaimNative')};
  const consent=$('#liveConsent');
  let boundProvider=null,announcedProvider=null,connectedAddress=null,liveSnapshot=null,refreshTimer=null,busy=false;

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
      const wei=BigInt(value||'0x0'),whole=wei/10n**18n;
      const fraction=(wei%10n**18n).toString().padStart(18,'0').slice(0,6).replace(/0+$/,'');
      return`${whole}${fraction?`.${fraction}`:''} ETH`;
    }catch{return'—';}
  };
  const toHex=value=>`0x${BigInt(value).toString(16)}`;
  const stateLabel=value=>({
    UNCONFIGURED:'Sin configurar',ACCOUNT_CREATED:'Cuenta creada',AWAITING_SESSION_SIGNATURE:'Esperando firma',SESSION_AUTHORIZED:'Sesión autorizada',
    SESSION_TESTED:'Sesión probada',ARMED_FOR_ROUND_TRIP:'Armada · prueba real',ROUND_TRIP_VALIDATED:'Ida/vuelta validada',AUTONOMOUS_LIMITED:'Autónoma limitada',
    STOPPING:'Liquidando',STOPPED:'Parada',DAILY_LOSS_STOP:'Stop diario',MANUAL_RECONCILIATION_REQUIRED:'Revisión manual',SESSION_ERROR:'Error de sesión',
    INFRASTRUCTURE_UNAVAILABLE:'Infraestructura no verificada',SESSION_SIGNER_MISMATCH:'Firmante no coincide',SESSION_SIGNER_UNAVAILABLE:'Firmante no disponible',LIVE_EXECUTION_DISABLED:'Ejecución desactivada',SESSION_EXPIRED:'Sesión caducada',SESSION_UNAVAILABLE_WITH_POSITION:'Posición requiere firma',
    EXECUTION_FAILED:'Operación fallida',EXIT_FAILED_OWNER_ACTION_REQUIRED:'Retirada manual necesaria',
    RECLAIM_PREPARING:'Preparando retirada',AWAITING_RECLAIM_SIGNATURE:'Firma de retirada',RECLAIM_SUBMITTED:'Retirada enviada',RECLAIMED:'Fondos retirados',NATIVE_RECLAIMED_TOKENS_REMAIN:'ETH retirado · tokens pendientes',RECLAIM_ERROR:'Error de retirada'
  }[value]||value||'Sin configurar');

  function setText(selector,value,title){const node=$(selector);if(node){node.textContent=value;if(title!=null)node.title=title;}}
  function liveNotice(message,tone=''){
    const node=$('#liveNotice');if(!node)return;
    node.textContent=message;node.classList.toggle('is-error',tone==='error');node.classList.toggle('is-good',tone==='good');
  }

  function renderOwner({state='No conectada',address=null,chainId=CHAIN_ID_DECIMAL,balance=null,error=false,notice=null,modeText=null}={}){
    setText('#walletState',state);setText('#walletAddress',shortAddress(address),address||'');
    setText('#walletNetwork',chainId===CHAIN_ID_DECIMAL?'Robinhood Chain · 4663':chainId?`Red incorrecta · ${chainId}`:'Red no detectada');
    setText('#walletBalance',balance==null?'—':formatWei(balance));
    status?.classList.toggle('is-connected',state==='Conectada'||state==='Solo lectura');status?.classList.toggle('is-error',error);
    if($('#walletNotice')&&notice)$('#walletNotice').textContent=notice;
    if(connectButton)connectButton.textContent=state==='Conectada'?'Actualizar cuenta':'Conectar Phantom';
    if(mode)mode.textContent=modeText||(state==='Conectada'?'PHANTOM PROPIETARIA':state==='Solo lectura'?'SOLO LECTURA · SIN FIRMA':'SIN PERMISO DE TRADING');
  }

  function renderLive(payload){
    liveSnapshot=payload||null;
    const readiness=payload?.readiness||{},state=payload?.state||{},balances=payload?.balances||{};
    const armed=readiness.armed===true,stopping=state.state==='STOPPING';
    const blocked=['DAILY_LOSS_STOP','MANUAL_RECONCILIATION_REQUIRED','SESSION_UNAVAILABLE_WITH_POSITION','SESSION_SIGNER_MISMATCH','SESSION_SIGNER_UNAVAILABLE','LIVE_EXECUTION_DISABLED','INFRASTRUCTURE_UNAVAILABLE','SESSION_EXPIRED','SESSION_ERROR','EXECUTION_FAILED','EXIT_FAILED_OWNER_ACTION_REQUIRED','NATIVE_RECLAIMED_TOKENS_REMAIN','RECLAIM_ERROR'].includes(state.state);
    setText('#liveAccount',readiness.smartAccount?shortAddress(state.accountAddress):'Sin crear',state.accountAddress||'');
    setText('#liveBalance',readiness.smartAccount?formatWei(balances.liquidWei):'—');
    setText('#liveSession',readiness.sessionTested?'Probada':readiness.sessionAuthorized?'Autorizada':state.state==='AWAITING_SESSION_SIGNATURE'?'Firma pendiente':'Sin autorizar');
    setText('#liveRoundTrip',readiness.roundTripValidated?'Validada':'Pendiente');
    setText('#livePositions',String(payload?.positions?.length||0));setText('#liveSignal',readiness.validEntryNow?'Sí':'No');
    const pill=$('#liveEnginePill');if(pill){pill.textContent=stateLabel(state.state);pill.classList.toggle('is-live',armed);pill.classList.toggle('is-stop',stopping||blocked);}
    if(mode&&connectedAddress)mode.textContent=armed?(readiness.roundTripValidated?'AUTONOMÍA LIMITADA':'VALIDACIÓN REAL ARMADA'):'PHANTOM PROPIETARIA';
    const connected=!!connectedAddress,walletApi=readiness.walletApi===true,infrastructure=readiness.infrastructure===true;
    if(controls.create)controls.create.disabled=busy||!connected||!walletApi||!infrastructure||readiness.smartAccount;
    if(controls.fund)controls.fund.disabled=busy||!connected||!readiness.smartAccount||readiness.funded;
    if(controls.authorize)controls.authorize.disabled=busy||!connected||!infrastructure||!readiness.funded||readiness.sessionAuthorized;
    if(controls.test)controls.test.disabled=busy||!connected||!infrastructure||!readiness.sessionAuthorized||readiness.sessionTested;
    if(controls.arm)controls.arm.disabled=busy||!connected||!infrastructure||!readiness.sessionTested||armed||!consent?.checked;
    if(controls.stop)controls.stop.disabled=busy||!connected||!readiness.smartAccount||stopping;
    if(controls.reclaim)controls.reclaim.disabled=busy||!connected||!readiness.smartAccount||armed||BigInt(balances.liquidWei||0)<=0n;
    if(controls.reclaimNative)controls.reclaimNative.disabled=busy||!connected||!readiness.smartAccount||armed||BigInt(balances.liquidWei||0)<=0n;
    if(stopping)liveNotice('Las entradas están bloqueadas. Si había una posición, el motor está intentando liquidarla.','error');
    else if(blocked)liveNotice(`Operativa bloqueada: ${stateLabel(state.state)}. Revisa el estado y usa la retirada a Phantom si hay saldo o tokens.`, 'error');
    else if(armed&&!readiness.validEntryNow)liveNotice('Autonomía activa. No hay una entrada válida ahora: la app espera sin forzar operaciones.','good');
    else if(armed)liveNotice('Autonomía activa y señal candidata detectada. Antes de enviar, el servidor vuelve a cotizar, simular y comprobar todos los gates.','good');
    else if(readiness.sessionTested)liveNotice('Sesión probada. Marca la aceptación de riesgo y arma el piloto cuando quieras.');
    else if(readiness.sessionAuthorized)liveNotice('Sesión limitada autorizada. Ejecuta la prueba técnica de valor cero antes de armar.');
    else if(readiness.funded)liveNotice('Cuenta operativa fondeada. El siguiente paso autoriza durante 7 días sólo las funciones y el gasto del piloto.');
    else if(readiness.smartAccount)liveNotice('Cuenta separada creada. Fondea únicamente lo que falta hasta 0,005 ETH.');
    else if(!walletApi)liveNotice('El firmante limitado del servidor todavía no está configurado. No se puede armar.','error');
    else if(!infrastructure)liveNotice('Robinhood Chain o los contratos de ejecución no han superado la verificación. La operativa permanece bloqueada.','error');
    else liveNotice('Crea la cuenta operativa separada. Phantom seguirá siendo su única propietaria.');
  }

  async function api(url,{method='GET',payload}={}){
    if(typeof fetch!=='function')throw new Error('API no disponible en este navegador');
    const response=await fetch(url,{method,cache:'no-store',headers:payload?{'content-type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});
    let data={};try{data=await response.json()}catch{}
    if(!response.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.code=data.code;throw error;}
    return data;
  }

  async function switchToRobinhood(provider){
    const current=await provider.request({method:'eth_chainId'});
    if(normalizeChain(current)===CHAIN_ID_DECIMAL)return;
    await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_ID_HEX}]});
    const switched=await provider.request({method:'eth_chainId'});
    if(normalizeChain(switched)!==CHAIN_ID_DECIMAL)throw new Error('Phantom no cambió a Robinhood Chain');
  }

  async function refreshLive(){
    if(!connectedAddress||typeof fetch!=='function')return;
    try{renderLive(await api(`/api/live/status?owner=${encodeURIComponent(connectedAddress)}`));}
    catch(error){liveNotice(`Estado operativo no disponible: ${error.message}`,'error');}
  }

  async function refresh({prompt=false}={}){
    const provider=ethereum();
    if(!provider){
      const notice=isEmbedded()?'Phantom no se inyecta dentro de este visor. Abre Trenches fuera del visor para conectar. Nunca te pedirá la seed phrase.':'Phantom no está disponible. Abre Trenches en el navegador de Phantom o instala su extensión. Nunca te pedirá la seed phrase.';
      renderOwner({state:'Phantom no detectada',error:true,notice});return;
    }
    if(connectButton)connectButton.disabled=true;
    try{
      const accounts=await provider.request({method:prompt?'eth_requestAccounts':'eth_accounts'}),address=Array.isArray(accounts)?accounts[0]:null;
      if(!address){connectedAddress=null;renderOwner({state:'No conectada',notice:'Pulsa Conectar Phantom. Ningún permiso se concede sin una acción explícita.'});return;}
      await switchToRobinhood(provider);
      const [chain,balance]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_getBalance',params:[address,'latest']})]);
      connectedAddress=String(address).toLowerCase();
      renderOwner({state:'Conectada',address:connectedAddress,chainId:normalizeChain(chain),balance,notice:'Phantom verificada como propietaria. La app sólo podrá operar después de crear, limitar, probar y armar la cuenta separada.'});
      if(watchInput)watchInput.value=connectedAddress;bind(provider);await refreshLive();
    }catch(error){
      connectedAddress=null;const rejected=Number(error?.code)===4001;
      renderOwner({state:rejected?'Conexión cancelada':'Revisión necesaria',error:true,notice:rejected?'Phantom no concedió acceso. No se ha realizado ninguna acción.':`No se pudo validar Robinhood Chain: ${error?.message||'error desconocido'}`});
    }finally{if(connectButton)connectButton.disabled=false;}
  }

  async function signedProof(action){
    const provider=ethereum();if(!provider||!connectedAddress)throw new Error('Conecta Phantom primero');
    await switchToRobinhood(provider);
    const challenge=await api(`/api/live/challenge?address=${encodeURIComponent(connectedAddress)}&action=${encodeURIComponent(action)}`);
    const bytes=new TextEncoder().encode(challenge.message),hex=`0x${Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')}`;
    const signature=await provider.request({method:'personal_sign',params:[hex,connectedAddress]});
    return{...challenge,signature};
  }

  async function act(button,message,work){
    if(busy)return;busy=true;const previous=button?.textContent;if(button){button.disabled=true;button.textContent=message;}
    try{await work();await refreshLive();}
    catch(error){const cancelled=Number(error?.code)===4001;liveNotice(cancelled?'Acción cancelada en Phantom. No se ha enviado nada.':`${error.message||'La acción falló'}. La autonomía permanece bloqueada.`,'error');}
    finally{busy=false;if(button&&previous)button.textContent=previous;if(liveSnapshot)renderLive(liveSnapshot);}
  }

  async function createAccount(){
    const proof=await signedProof(ACTIONS.create),result=await api('/api/live/account/request',{method:'POST',payload:{proof}});
    liveNotice(`Cuenta separada ${shortAddress(result.accountAddress)} creada. Aún no puede operar.`,'good');
  }
  async function fundAccount(){
    const provider=ethereum(),target=liveSnapshot?.state?.accountAddress,required=BigInt(liveSnapshot?.policy?.pilotBankrollWei||0),current=BigInt(liveSnapshot?.balances?.nativeWei||0),amount=required-current;
    if(!provider||!target||amount<=0n)return;
    const hash=await provider.request({method:'eth_sendTransaction',params:[{from:connectedAddress,to:target,value:toHex(amount)}]});
    liveNotice(`Fondeo enviado (${String(hash).slice(0,10)}…). Esperando confirmación.`);
    let confirmed=false;
    for(let attempt=0;attempt<45;attempt++){
      const receipt=await provider.request({method:'eth_getTransactionReceipt',params:[hash]});
      if(receipt){if(receipt.status!=='0x1')throw new Error('La transacción de fondeo revirtió');confirmed=true;break;}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    if(!confirmed)throw new Error('El fondeo sigue pendiente; comprueba Phantom antes de repetirlo');
  }
  async function authorizeSession(){
    const proof=await signedProof(ACTIONS.session),request=await api('/api/live/session/request',{method:'POST',payload:{proof}}),signatureRequest=request.signatureRequest;
    if(signatureRequest?.type!=='eth_signTypedData_v4'||!signatureRequest.data)throw new Error('La autorización limitada recibida no es válida');
    const signature=await ethereum().request({method:'eth_signTypedData_v4',params:[connectedAddress,JSON.stringify(signatureRequest.data)]});
    await api('/api/live/session/authorize',{method:'POST',payload:{ownerAddress:connectedAddress,sessionId:request.sessionId,signature}});
    liveNotice('Sesión limitada firmada. La clave de Phantom no ha salido de Phantom.','good');
  }
  async function testSession(){const proof=await signedProof(ACTIONS.test);await api('/api/live/session/test',{method:'POST',payload:{proof}});liveNotice('Prueba técnica confirmada en Robinhood Chain.','good');}
  async function arm(){
    if(!consent?.checked)throw new Error('Marca primero la aceptación del riesgo del piloto');
    const proof=await signedProof(ACTIONS.arm);await api('/api/live/arm',{method:'POST',payload:{proof}});
    liveNotice('Autonomía limitada armada. Si no hay señal válida, no hará nada.','good');
  }
  async function stop(){const proof=await signedProof(ACTIONS.stop);await api('/api/live/pause',{method:'POST',payload:{proof}});liveNotice('Stop activado: nuevas entradas bloqueadas y posiciones en liquidación.','error');}
  async function signOwnerRequest(signatureRequest){
    if(signatureRequest?.type==='eth_signTypedData_v4'&&signatureRequest.data)return ethereum().request({method:'eth_signTypedData_v4',params:[connectedAddress,JSON.stringify(signatureRequest.data)]});
    if(signatureRequest?.type==='personal_sign'&&signatureRequest.data){
      const data=typeof signatureRequest.data==='string'?signatureRequest.data:signatureRequest.data.raw;
      return ethereum().request({method:'personal_sign',params:[data,connectedAddress]});
    }
    throw new Error('Phantom no puede firmar el formato de retirada recibido');
  }
  async function reclaim(nativeOnly=false){
    const proof=await signedProof(ACTIONS.reclaim),request=await api('/api/live/reclaim/request',{method:'POST',payload:{proof,nativeOnly}});
    const amount=formatWei(request.amountWei),tokens=request.tokenTransfers?.length?` y ${request.tokenTransfers.length} posición(es) como token`:'';
    const warning=nativeOnly?' Modo emergencia: los tokens ERC-20 permanecerán en la cuenta operativa.':'';
    if(typeof window.confirm==='function'&&!window.confirm(`Retirar ${amount}${tokens} desde la cuenta operativa a ${shortAddress(connectedAddress)}. La reserva de gas permanecerá separada.${warning} ¿Continuar?`)){
      const error=new Error('Retirada cancelada');error.code=4001;throw error;
    }
    const signature=await signOwnerRequest(request.signatureRequest);
    await api('/api/live/reclaim/authorize',{method:'POST',payload:{ownerAddress:connectedAddress,reclaimId:request.id,signature}});
    liveNotice(`${amount} retirados a Phantom${nativeOnly?'; los tokens siguen registrados en la cuenta operativa para recuperarlos después':''}. La sesión autónoma local ha quedado inutilizada.`,'good');
  }

  async function watchAddress(value,{persist=true}={}){
    const address=String(value||'').trim();
    if(!/^0x[a-fA-F0-9]{40}$/.test(address)){renderOwner({state:'Dirección inválida',error:true,notice:'Pega una dirección EVM completa. No pegues una seed phrase ni una clave privada.'});return;}
    if(watchButton)watchButton.disabled=true;
    try{
      const payload=await api(`/api/wallet/balance?address=${encodeURIComponent(address)}`);
      renderOwner({state:'Solo lectura',address:payload.address||address,chainId:normalizeChain(payload.chainId),balance:payload.balance,notice:'Cuenta encontrada en Robinhood Chain. Esta dirección pública no permite firmar, comprar, vender ni mover fondos.',modeText:'SOLO LECTURA · SIN FIRMA'});
      if(watchInput)watchInput.value=payload.address||address;if(persist)try{window.localStorage?.setItem('trenches:watchAddress',payload.address||address)}catch{}
    }catch(error){renderOwner({state:'Consulta no disponible',error:true,notice:`No se pudo leer la cuenta en Robinhood Chain: ${error?.message||'error desconocido'}.`});}
    finally{if(watchButton)watchButton.disabled=false;}
  }

  function bind(provider){
    if(boundProvider===provider||typeof provider?.on!=='function')return;boundProvider=provider;
    provider.on('accountsChanged',()=>refresh());provider.on('chainChanged',()=>refresh());provider.on('disconnect',()=>{connectedAddress=null;renderOwner({state:'Desconectada',notice:'Phantom se ha desconectado. El estado del motor permanece en el servidor; vuelve a conectar para controlarlo.'});});
  }

  window.addEventListener?.('eip6963:announceProvider',event=>{const provider=event?.detail?.provider;if(isPhantom(provider))announcedProvider=provider;});
  if(typeof window.Event==='function')window.dispatchEvent?.(new window.Event('eip6963:requestProvider'));
  connectButton?.addEventListener('click',()=>refresh({prompt:true}));watchForm?.addEventListener('submit',event=>{event.preventDefault();watchAddress(watchInput?.value)});
  controls.create?.addEventListener('click',()=>act(controls.create,'Firmando…',createAccount));controls.fund?.addEventListener('click',()=>act(controls.fund,'Confirmando…',fundAccount));
  controls.authorize?.addEventListener('click',()=>act(controls.authorize,'Autorizando…',authorizeSession));controls.test?.addEventListener('click',()=>act(controls.test,'Probando…',testSession));
  controls.arm?.addEventListener('click',()=>act(controls.arm,'Armando…',arm));controls.stop?.addEventListener('click',()=>act(controls.stop,'Parando…',stop));
  controls.reclaim?.addEventListener('click',()=>act(controls.reclaim,'Retirando…',()=>reclaim(false)));
  controls.reclaimNative?.addEventListener('click',()=>act(controls.reclaimNative,'Retirando…',()=>reclaim(true)));
  consent?.addEventListener('change',()=>liveSnapshot&&renderLive(liveSnapshot));
  document.addEventListener('trenches:viewchange',event=>{
    if(event.detail?.view==='desk'){
      refresh();if(refreshTimer&&typeof clearInterval==='function')clearInterval(refreshTimer);
      if(typeof setInterval==='function')refreshTimer=setInterval(refreshLive,15000);
    }else if(refreshTimer&&typeof clearInterval==='function'){clearInterval(refreshTimer);refreshTimer=null;}
  });
  try{const saved=window.localStorage?.getItem('trenches:watchAddress');if(watchInput&&/^0x[a-fA-F0-9]{40}$/.test(saved||''))watchInput.value=saved;}catch{}
  const desk=document.querySelector('[data-view-panel="desk"]');if(desk&&!desk.hidden)refresh();
})();
