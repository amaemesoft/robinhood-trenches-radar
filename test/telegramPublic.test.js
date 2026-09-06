'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanChannel,parseChannelHtml,TelegramPublicClient}=require('../lib/telegramPublic');

const CA='0x38aaf33082b20aff2e33433138de920f131b7777';
const OTHER='0x4c4cddb8138c97b123375cf65b0456ae877410da';

function ownMessage(id,text,extra=''){
  return `<div class="tgme_widget_message js-widget_message" data-post="hellokook/${id}">
    ${extra}
    <div class="tgme_widget_message_text js-message_text">${text}</div>
    <a class="tgme_widget_message_date"><time datetime="2026-09-06T12:43:00+00:00"></time></a>
  </div>`;
}

test('parses original channel posts with exact EVM contracts',()=>{
  const html=ownMessage('4001',`☄️ ASTEROID<br>ca: <code>${CA}</code> and again ${CA}`)+
    ownMessage('4002',`YODA ca ${OTHER}`);
  const posts=parseChannelHtml(html,'hellokook');
  assert.equal(posts.length,2);
  assert.equal(posts[0].id,'4001');
  assert.deepEqual(posts[0].tokenAddresses,[CA]);
  assert.equal(posts[0].at,'2026-09-06T12:43:00.000Z');
  assert.equal(posts[0].url,'https://t.me/hellokook/4001');
  assert.deepEqual(posts[1].tokenAddresses,[OTHER]);
});

test('drops forwarded posts and malformed addresses',()=>{
  const forwarded=ownMessage('4003',`bot buy ${CA}`,'<div class="tgme_widget_message_forwarded_from">Forwarded from Robinhood BuyBot</div>');
  const malformed=ownMessage('4004','not a CA 0x1234');
  assert.deepEqual(parseChannelHtml(forwarded+malformed,'hellokook'),[]);
});

test('client reads public /s channel without credentials',async()=>{
  let seenUrl,seenOptions;
  const client=new TelegramPublicClient({fetchImpl:async(url,options)=>{
    seenUrl=String(url);seenOptions=options;
    return{ok:true,status:200,text:async()=>ownMessage('4005',`ca ${CA}`)};
  }});
  const posts=await client.latestPosts('@hellokook');
  assert.equal(cleanChannel('https://t.me/s/hellokook/'),'hellokook');
  assert.equal(seenUrl,'https://t.me/s/hellokook');
  assert.equal(seenOptions.headers.authorization,undefined);
  assert.equal(posts.length,1);
});
