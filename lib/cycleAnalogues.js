'use strict';

// Historical references are qualitative calibration anchors, not backtested score vectors.
// They describe trajectory archetypes observed in prior meme cycles and are only surfaced
// when current measured behaviour resembles the relevant pattern.
const REFERENCES={
  PEPE:{label:'PEPE',pattern:'viral-cultural-escape',class:'COMPOUNDER',lesson:'pre-existing universal meme + explosive social/holder propagation; exchange listings accelerated an already-live cultural loop'},
  WIF:{label:'WIF',pattern:'portable-native-meme',class:'COMPOUNDER',lesson:'extremely simple remixable visual + organic community + chain beta; culture escaped crypto-native circles over months'},
  POPCAT:{label:'POPCAT',pattern:'slow-burn-survivor',class:'COMPOUNDER',lesson:'pre-existing internet meme + persistent community; months of survival and repeated expansion mattered more than launch-week velocity'},
  BONK:{label:'BONK',pattern:'chain-community-survivor',class:'COMPOUNDER',lesson:'broad chain-native distribution + ecosystem identity + ability to survive a deep drawdown and return'},
  MEW:{label:'MEW',pattern:'category-differentiation-compounder',class:'COMPOUNDER',lesson:'clear category positioning and consistent community growth can compound for months before a billion-dollar escape'},
  FARTCOIN:{label:'FARTCOIN',pattern:'narrative-hybrid-escape',class:'HYBRID',lesson:'a very simple meme can ride a powerful new narrative while remaining distinct enough to outlive the original catalyst'},
  BODEN:{label:'BODEN',pattern:'topical-meteor',class:'METEOR',lesson:'event-driven narrative can create extreme short-term multiples while long-horizon retention collapses when the catalyst expires'},
  BOME:{label:'BOME',pattern:'hypervelocity-launch',class:'METEOR',lesson:'extreme launch velocity can reach huge market cap in days; speed and listings alone are not proof of durable culture'},
  PNUT:{label:'PNUT',pattern:'real-world-viral-rocket',class:'HYBRID',lesson:'a real-world viral event can produce billion-dollar velocity in days; durability depends on whether culture survives after the news cycle'},
  MOODENG:{label:'MOODENG',pattern:'real-world-meme-escape',class:'HYBRID',lesson:'already-viral internet culture can transfer rapidly on-chain, but the token must prove it can persist after mainstream attention fades'}
};

function numericOrNull(value){return value!=null&&Number.isFinite(Number(value))?Number(value):null;}

function buildAnalogues({culture=0,holders=null,resilience=null,attention=0,market=0,organic=null,ageDays=null,resilienceStatus='UNKNOWN',sourceDiversity=0}={}){
  const out=[];
  const add=(key,confidence,why,warning=null)=>out.push({key,label:REFERENCES[key].label,pattern:REFERENCES[key].pattern,class:REFERENCES[key].class,confidence,why,lesson:REFERENCES[key].lesson,warning});
  const h=numericOrNull(holders),r=numericOrNull(resilience),o=numericOrNull(organic),age=numericOrNull(ageDays);

  if(culture>=78&&h!=null&&h>=68&&attention>=72)add('PEPE','MEDIUM','culture, holder adoption and attention are expanding together');
  if(culture>=72&&market>=58&&(o==null||o>=55)&&sourceDiversity>=1)add('WIF','MEDIUM','portable social propagation is combining with tradable market depth without obvious holder-price divergence');
  if(age!=null&&age>=30&&h!=null&&h>=62&&r!=null&&r>=68)add('POPCAT','HIGH','candidate has persisted long enough for holder retention and recovery to matter');
  if(r!=null&&r>=78&&h!=null&&h>=68&&market>=60)add('BONK','HIGH','holder base and market structure persisted through a material drawdown');
  if(age!=null&&age>=45&&culture>=62&&h!=null&&h>=62&&r!=null&&r>=55)add('MEW','MEDIUM','slow category expansion is being confirmed by holders and persistence rather than launch velocity');
  if(culture>=72&&sourceDiversity>=2&&o!=null&&o>=65&&attention>=58)add('FARTCOIN','MEDIUM','simple social identity is broadening across sources while holders absorb the move');

  // Meteor/hypervelocity analogues are warnings, not bullish endorsements.
  if(age!=null&&age<=14&&attention>=84&&resilienceStatus!=='MEASURED')add('BOME','LOW','launch/attention velocity is extreme but durability has not been tested','hypervelocity can be a false positive and a late-entry trap');
  if(age!=null&&age<=45&&attention>=78&&o!=null&&o<45&&resilienceStatus!=='MEASURED')add('BODEN','LOW','attention is outrunning holder absorption before resilience is known','meteor risk: narrative may decay faster than the holder base forms');
  if(age!=null&&age<=21&&attention>=82&&culture>=62&&sourceDiversity>=2&&resilienceStatus!=='MEASURED')add('PNUT','LOW','real-world-style viral acceleration is plausible from the speed and breadth of attention','verify that culture persists after the external news cycle');
  if(age!=null&&age<=30&&attention>=72&&culture>=68&&sourceDiversity>=2&&resilienceStatus!=='MEASURED')add('MOODENG','LOW','broad viral meme propagation is arriving before durability is measurable','mainstream virality can fade quickly if on-chain retention does not form');

  const priority={HIGH:3,MEDIUM:2,LOW:1};
  return out.sort((a,b)=>priority[b.confidence]-priority[a.confidence]).slice(0,4);
}

module.exports={REFERENCES,numericOrNull,buildAnalogues};
