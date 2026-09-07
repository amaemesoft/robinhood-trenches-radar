'use strict';

const REFERENCES={
  PEPE:{label:'PEPE',pattern:'viral-cultural-escape',lesson:'universal meme + explosive social/holder propagation; listings accelerated an already-live reflexive loop'},
  WIF:{label:'WIF',pattern:'portable-native-meme',lesson:'simple remixable visual + organic community + chain beta; grew from crypto-native culture into a billion-dollar identity'},
  POPCAT:{label:'POPCAT',pattern:'slow-burn-survivor',lesson:'pre-existing internet meme + community persistence; months of survival mattered more than launch-week velocity'},
  BONK:{label:'BONK',pattern:'chain-community-survivor',lesson:'broad chain-native distribution + ecosystem identity + ability to survive deep drawdowns and return'},
  BODEN:{label:'BODEN',pattern:'topical-meteor',lesson:'event-driven narrative can create extreme short-term multiples while long-horizon retention collapses'},
  BOME:{label:'BOME',pattern:'hypervelocity-launch',lesson:'extreme launch velocity can reach huge market cap in days; speed alone is not proof of durable culture'}
};

function buildAnalogues({culture=0,holders=null,resilience=null,attention=0,market=0,organic=null,ageDays=null,resilienceStatus='UNKNOWN'}={}){
  const out=[];
  const add=(key,confidence,why,warning=null)=>out.push({key,label:REFERENCES[key].label,pattern:REFERENCES[key].pattern,confidence,why,lesson:REFERENCES[key].lesson,warning});

  if(culture>=78&&Number(holders)>=68&&attention>=72){
    add('PEPE','MEDIUM','culture + holders + attention are expanding together');
  }
  if(culture>=72&&attention>=62&&market>=58){
    add('WIF','MEDIUM','portable social propagation is combining with tradable market depth');
  }
  if(Number(ageDays)>=30&&Number(holders)>=62&&Number(resilience)>=68){
    add('POPCAT','HIGH','candidate has survived long enough for holder growth and recovery to matter');
  }
  if(Number(resilience)>=78&&Number(holders)>=68&&market>=60){
    add('BONK','HIGH','holder base and market structure persisted through a material drawdown');
  }
  if(Number(ageDays)!=null&&ageDays<=14&&attention>=84&&resilienceStatus!=='MEASURED'){
    add('BOME','LOW','launch/attention velocity is extreme but durability has not been tested','hypervelocity can be a false positive');
  }
  if(Number(ageDays)!=null&&ageDays<=45&&attention>=78&&Number(organic)!=null&&organic<45&&resilienceStatus!=='MEASURED'){
    add('BODEN','LOW','price/attention are outrunning holder absorption before resilience is known','meteor risk: narrative may decay faster than the holder base forms');
  }
  return out.slice(0,3);
}

module.exports={REFERENCES,buildAnalogues};
