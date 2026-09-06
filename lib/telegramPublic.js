'use strict';

const DEFAULT_BASE_URL='https://t.me/s';
const EVM_ADDRESS_RE=/\b0x[a-fA-F0-9]{40}\b/g;

function cleanChannel(value){
  return String(value||'').trim().replace(/^@/,'').replace(/^https?:\/\/t\.me\/(?:s\/)?/i,'').replace(/\/$/,'');
}

function decodeHtml(value){
  return String(value||'')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'");
}

function htmlToText(html){
  return decodeHtml(String(html||'')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,' '))
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .trim();
}

function extractEvmAddresses(text){
  const matches=String(text||'').match(EVM_ADDRESS_RE)||[];
  return [...new Set(matches.map(address=>address.toLowerCase()))];
}

function messageBlocks(html){
  const source=String(html||'');
  const starts=[];
  const re=/<div\b[^>]*class="[^"]*\btgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[^>]*>/gi;
  let match;
  while((match=re.exec(source)))starts.push({index:match.index,post:match[1]});
  return starts.map((item,index)=>({
    post:item.post,
    html:source.slice(item.index,index+1<starts.length?starts[index+1].index:source.length)
  }));
}

function normalizeBlock(block,expectedChannel){
  if(!block?.post||!block?.html)return null;
  const channel=cleanChannel(expectedChannel);
  const [postChannel,messageId]=String(block.post).split('/');
  if(!channel||!messageId||String(postChannel||'').toLowerCase()!==channel.toLowerCase())return null;

  // Forwarded/bot reposts are context, not an original conviction signal from the tracked scout.
  if(/tgme_widget_message_forwarded_from/i.test(block.html))return null;

  const textMatch=block.html.match(/<div\b[^>]*class="[^"]*\btgme_widget_message_text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const text=htmlToText(textMatch?.[1]||'');
  const tokenAddresses=extractEvmAddresses(text);
  if(!tokenAddresses.length)return null;

  const timeMatch=block.html.match(/<time\b[^>]*datetime="([^"]+)"/i);
  const parsed=Date.parse(decodeHtml(timeMatch?.[1]||''));
  const at=Number.isFinite(parsed)?new Date(parsed).toISOString():null;

  return{
    id:String(messageId),
    channel,
    at,
    url:`https://t.me/${channel}/${messageId}`,
    text,
    tokenAddresses
  };
}

function parseChannelHtml(html,channel){
  return messageBlocks(html).map(block=>normalizeBlock(block,channel)).filter(Boolean);
}

class TelegramPublicClient{
  constructor({baseUrl=DEFAULT_BASE_URL,fetchImpl=globalThis.fetch,timeoutMs=12000}={}){
    this.baseUrl=String(baseUrl||DEFAULT_BASE_URL).replace(/\/$/,'');
    this.fetch=fetchImpl;
    this.timeoutMs=Number(timeoutMs)||12000;
  }

  async latestPosts(channel){
    const clean=cleanChannel(channel);
    if(!clean)return[];
    const response=await this.fetch(`${this.baseUrl}/${encodeURIComponent(clean)}`,{
      headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0 (compatible; RobinhoodTrenchesRadar/0.4; +https://github.com/amaemesoft/robinhood-trenches-radar)'},
      signal:AbortSignal.timeout(this.timeoutMs)
    });
    if(!response.ok)throw new Error(`Telegram HTTP ${response.status}`);
    const html=await response.text();
    return parseChannelHtml(html,clean);
  }
}

module.exports={TelegramPublicClient,cleanChannel,decodeHtml,htmlToText,extractEvmAddresses,messageBlocks,normalizeBlock,parseChannelHtml};
