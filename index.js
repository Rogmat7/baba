const { execSync } = require('child_process');

// ==========================================
// 📦 1. AUTO-INSTALLER (Disesuaikan untuk Node v12)
// ==========================================
try {
    require.resolve('telegram');
    require.resolve('input');
} catch (e) {
    console.log('📦 Modul tidak ditemukan, menginstal sekarang...');
    try {
        // Menggunakan --no-engines untuk memaksa install di Node lama
        execSync('npm install telegram input --no-engines', { stdio: 'inherit' });
        console.log('✅ Instalasi selesai!');
    } catch (err) {
        console.error('❌ Gagal install:', err.message);
    }
}

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');

// ==========================================
// 👑 2. KONFIGURASI
// ==========================================
const OWNER_API_ID = 29798494; 
const OWNER_API_HASH = '53273c1de3e68a9ecdb90de2dcf46f6c';

// Masukkan Session String di sini agar tidak perlu OTP di Panel
const OWNER_SESSION_STRING = ""; 

let ownerClient = null;
let relayBots = [];
let isAutoBcRunning = false;
let autoBcDelay = 5; 
let autoBcMessages = [];
let broadcastInterval = null;
let quoteMessage = null;

// ==========================================
// 🔐 3. FUNGSI LOGIN
// ==========================================
async function loginOwner() {
  console.log('🔐 Mencoba Login OWNER...');
  const stringSession = new StringSession(OWNER_SESSION_STRING);
  
  ownerClient = new TelegramClient(stringSession, OWNER_API_ID, OWNER_API_HASH, {
    connectionRetries: 5,
  });

  try {
    await ownerClient.start({
      phoneNumber: async () => await input.text('📞 Nomor HP: '),
      password: async () => await input.text('🔐 Password 2FA: '),
      phoneCode: async () => await input.text('📲 Kode OTP: '),
      onError: (err) => console.log('❌ Login Error:', err.message),
    });

    const me = await ownerClient.getMe();
    console.log('✅ Berhasil Login sebagai: ' + me.firstName);
    
    if (!OWNER_SESSION_STRING) {
        console.log('\n🎫 SESSION STRING ANDA:\n' + ownerClient.session.save() + '\n');
    }

    setupOwnerHandler(ownerClient);
  } catch (err) {
    console.error('❌ GAGAL LOGIN:', err.message);
  }
}

// ==========================================
// 🎯 4. HANDLER PERINTAH (Syntax disesuaikan untuk Node v12)
// ==========================================
function setupOwnerHandler(client) {
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg.out || !msg.text) return;

    const text = msg.text.trim();
    const args = text.split(/\s+/);

    if (text === '.help') {
      await msg.reply({ message: "👑 **COMMANDS**\n.autobc on/off/status\n.addkutip (reply)\n.autobc remove" });
      return;
    }

    if (args[0] === '.addkutip' && msg.replyTo) {
      const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
      if (reply && reply[0]) {
        quoteMessage = reply[0];
        await msg.reply({ message: '✅ Kutipan disimpan.' });
      }
      return;
    }

    if (text.startsWith('.autobc')) {
      await handleAutoBcCommand(msg, client);
    }
  }, new NewMessage({}));
}

// ==========================================
// 🚀 5. LOGIKA BROADCAST
// ==========================================
async function performBroadcastCycle() {
  if (!isAutoBcRunning) return;
  console.log('📢 Menjalankan Broadcast...');

  const activeClients = [ownerClient].concat(relayBots);
  
  for (let i = 0; i < activeClients.length; i++) {
    const client = activeClients[i];
    try {
      const dialogs = await client.getDialogs({ limit: 50 });
      for (let j = 0; j < dialogs.length; j++) {
        const dialog = dialogs[j];
        if (!isAutoBcRunning) break;
        if (!(dialog.isGroup || dialog.isChannel)) continue;

        try {
          if (quoteMessage) {
            await client.forwardMessages(dialog.id, {
              messages: [quoteMessage.id],
              fromPeer: quoteMessage.peerId,
            });
          } else if (autoBcMessages.length > 0) {
            const randomMsg = autoBcMessages[Math.floor(Math.random() * autoBcMessages.length)];
            await client.sendMessage(dialog.id, { message: randomMsg });
          }
          await new Promise(function(r) { setTimeout(r, 3000); }); 
        } catch (err) {}
      }
    } catch (err) {}
  }
}

async function handleAutoBcCommand(message, client) {
  const args = message.text.split(/\s+/);
  const subCmd = args[1] ? args[1].toLowerCase() : null;

  if (!subCmd && message.replyTo) {
    const reply = await client.getMessages(message.peerId, { ids: message.replyTo.replyToMsgId });
    if (reply && reply[0] && reply[0].message) {
      autoBcMessages.push(reply[0].message);
      await message.reply({ message: '✅ Pesan teks ditambahkan.' });
    }
    return;
  }

  if (subCmd === 'on') {
    isAutoBcRunning = true;
    if (broadcastInterval) clearInterval(broadcastInterval);
    broadcastInterval = setInterval(performBroadcastCycle, autoBcDelay * 60 * 1000);
    performBroadcastCycle();
    await message.reply({ message: '🟢 Broadcast Aktif.' });
  } else if (subCmd === 'off') {
    isAutoBcRunning = false;
    clearInterval(broadcastInterval);
    await message.reply({ message: '🔴 Broadcast Mati.' });
  } else if (subCmd === 'status') {
    await message.reply({ message: '📊 Status: ' + (isAutoBcRunning ? 'Running' : 'Stopped') + '\nDelay: ' + autoBcDelay + 'm' });
  } else if (subCmd === 'remove') {
    autoBcMessages = [];
    quoteMessage = null;
    await message.reply({ message: '🗑️ Data dihapus.' });
  }
}

async function main() {
  await loginOwner();
  setInterval(function() { }, 1000 * 60);
}

main().catch(console.error);
