'use strict';

// Public Robinhood-chain wallet attributions used only to widen observation coverage.
// These actors start PROVISIONAL with sampleSize=0 and no role/edge priors.
// Attribution is deliberately separate from measured trading performance.
const PROVISIONAL_MONEY_WALLETS = [
  ['money_change','change','0x92bff72e6c943a1348aedf15d68e758e811dec64'],
  ['money_PoorGoat','PoorGoat_','0x9ce0cb4a193acbce0dca3283972341aed6f3f614'],
  ['money_Salem1299534','Salem1299534','0xb8f305f27ccc406373de0082cc06cb1d065504ea'],
  ['money_Natan_benish','Natan_benish','0x1890e719822bc704c4f117aa4109401c2bab6f79'],
  ['money_Aurelius0121','Aurelius0121','0x0c175c6a0065ee05f871a68783d2de432a1e6cbe'],
  ['money_brrrgrrrz','brrrgrrrz','0x8e4f5d00a5f4d7877a0f66b98fdf9d40323bc52a'],
  ['money_Quanterty','Quanterty','0x0121525f755c9e7bbc525bba6672716ab46ced57'],
  ['money_ogle','ogle','0x1bcc5f67cd17e13770f199fa03bc043b0cde1143'],
  ['money_0xAvast','0xAvast','0xcc0c581613dfd4ace7c8686668427236f8bd5cc5'],
  ['money_kyle','kyle','0x39b337121494b10cffe3e581ab3281b2d62c5b08'],
  ['money_econoar','econoar','0x1605b59dfe3c1742c815d604aab6a2faa3a5c91f'],
  ['money_traderpow','traderpow','0xbe38d196d1378f8388c94c3ed73c3c11632eea7e'],
  ['money_CryptoKaleo','CryptoKaleo','0xd770b3db81dd31afb3d294496d66509302f3665e'],
  ['money_MINHxDYNASTY','MINHxDYNASTY','0xa984149da86ad9cc8d67a47e3d7b57adb1415502'],
  ['money_bluntz_capital','bluntz_capital','0x551ee8420d4a1711e5f63eb47c532738940805c8'],
  ['money_loganlim_x','loganlim_x','0x8224c04a8f66557df682fd0581eb3724bd2bee07'],
  ['money_rasmr','rasmr','0x2fbd041a069bb3d7099d55179169091cfeec4221'],
  ['money_orangie','orangie','0x0eb6f8e5c8bc7d5c920d485b7b3d52e56cdef21f'],
  ['money_notanicecat69','notanicecat69','0xb02208d1b27811480cf6171bccc2b7af9513cddb'],
  ['money_fibs','fibs','0x80f3b0b712a82172a67e454e313ba6e2b0e7ae64']
].map(([id,handle,evmAddress])=>({
  id,handle,evmAddress:evmAddress.toLowerCase(),kind:'money',role:'confirmation',
  identityConfidence:'attributed',attributionStatus:'provisional',
  walletSource:'public-robinhood-onchain-attribution',sampleSize:0,enabled:true,lastEventAt:null
}));

module.exports=PROVISIONAL_MONEY_WALLETS;
