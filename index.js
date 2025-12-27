const { execSync } = require('child_process');

// ==========================================
// 📦 1. AUTO-INSTALLER (Pterodactyl Ready)
// ==========================================
try {
    require.resolve('telegram');
    require.resolve('input');
} catch (e) {
    console.log('📦 Modul tidak ditemukan, menginstal sekarang...');
    try {
        execSync('npm install telegram input', { stdio: 'inherit' });
        console.log('✅ Instalasi selesai! Memulai bot...');
    } catch (err) {
        console.error('❌ Gagal menginstal modul otomatis:', err.message);
    }
}

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');

// ==========================================
// 👑 2. KONFIGURASI (PENTING)
// ==========================================
// Ambil API ID & Hash dari https://my.telegram.org
const OWNER_API_ID = 29798494; 
const OWNER_API_HASH = '53273c1de3e68a9ecdb90de2dcf46f6c';

/**
 * 💡 TIPS PTERODACTYL:
 * Karena panel tidak mendukung input terminal yang lama, 
 * jalankan script ini sekali di PC lokal untuk mendapatkan StringSession.
 * Masukkan kode panjang tersebut ke OWNER_SESSION_STRING di bawah ini.
 */
const OWNER_SESSION_STRING = ""; 

let ownerClient = null;
let relayBots = [];
let isAutoBcRunning = false;
let autoBcDelay = 5; // Menit
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
      phoneNumber: async () => await input.text('📞 Masukkan Nomor HP (+62...): '),
      password: async () => await input.text('🔐 Masukkan Password 2FA: '),
      phoneCode: async () => await input.text('📲 Masukkan Kode OTP: '),
      onError: (err) => console.log('❌ Login Error:', err.message),
    });

    const me = await ownerClient.getMe();
    console.log(`✅ Berhasil Login sebagai: ${me.firstName}`);
    
    // Tampilkan session string agar user bisa menyimpannya untuk Pterodactyl
    if (!OWNER_SESSION_STRING) {
        console.log('\n--- 🎫 SESSION STRING ANDA ---');
        console.log(ownerClient.session.save());
        console.log('------------------------------\n');
        console.log('💡 SIMPAN kode di atas ke variabel OWNER_SESSION_STRING agar tidak perlu OTP lagi.\n');
    }

    setupOwnerHandler(ownerClient);
  } catch (err) {
    console.error('❌ GAGAL LOGIN:', err.message);
  }
}

// ==========================================
// 🎯 4. HANDLER PERINTAH OWNER
// ==========================================
function setupOwnerHandler(client) {
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg.out || !msg.text) return; // Hanya baca pesan keluar dari owner

    const text = msg.text.trim();
    const args = text.split(/\s+/);

    // Command Help
    if (text === '.help') {
      const helpText = `
👑 **COMMAND BROADCAST**
.autobc on       - Mulai Broadcast
.autobc off      - Berhenti
.autobc status   - Cek status
.autobc delay X  - Set delay (menit)
.addkutip        - Simpan pesan (reply ke pesan)
.autobc remove   - Reset daftar pesan
      `;
      await msg.reply({ message: helpText });
      return;
    }

    // Add Kutipan (Media/Text)
    if (args[0] === '.addkutip' && msg.replyTo) {
      try {
        const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
        if (reply[0]) {
          quoteMessage = reply[0];
          await msg.reply({ message: '✅ Pesan berhasil disimpan sebagai kutipan broadcast.' });
        }
      } catch (e) {
        await msg.reply({ message: '❌ Gagal mengambil pesan: ' + e.message });
      }
      return;
    }

    // Handle AutoBC commands
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
  console.log(`📢 Menjalankan Broadcast: ${new Date().toLocaleTimeString()}`);

  const activeClients = [ownerClient, ...relayBots];
  
  for (const client of activeClients) {
    try {
      const dialogs = await client.getDialogs({ limit: 50 });
      for (const dialog of dialogs) {
        if (!isAutoBcRunning) break;
        if (!(dialog.isGroup || dialog.isChannel)) continue;

        try {
          if (quoteMessage) {
            // Forward kutipan
            await client.forwardMessages(dialog.id, {
              messages: [quoteMessage.id],
              fromPeer: quoteMessage.peerId,
            });
          } else if (autoBcMessages.length > 0) {
            // Kirim teks random
            const randomMsg = autoBcMessages[Math.floor(Math.random() * autoBcMessages.length)];
            await client.sendMessage(dialog.id, { message: randomMsg });
          }
          // Jeda antar grup (menghindari limit)
          await new Promise(r => setTimeout(r, 3000)); 
        } catch (err) {}
      }
    } catch (err) {
      console.log('⚠️ Error pada salah satu akun relay:', err.message);
    }
  }
}

async function handleAutoBcCommand(message, client) {
  const args = message.text.split(/\s+/);
  const subCmd = args[1]?.toLowerCase();

  // Jika reply tanpa subcmd, tambahkan ke list teks
  if (!subCmd && message.replyTo) {
    const reply = await client.getMessages(message.peerId, { ids: message.replyTo.replyToMsgId });
    if (reply[0]?.message) {
      autoBcMessages.push(reply[0].message);
      await message.reply({ message: `✅ Pesan teks ditambahkan. Total: ${autoBcMessages.length}` });
    }
    return;
  }

  switch (subCmd) {
    case 'on':
      if (isAutoBcRunning) return await message.reply({ message: '⚠️ Broadcast sudah berjalan.' });
      isAutoBcRunning = true;
      if (broadcastInterval) clearInterval(broadcastInterval);
      broadcastInterval = setInterval(performBroadcastCycle, autoBcDelay * 60 * 1000);
      performBroadcastCycle();
      await message.reply({ message: `🟢 Broadcast DIAKTIFKAN. Delay: ${autoBcDelay} mnt.` });
      break;
    case 'off':
      isAutoBcRunning = false;
      clearInterval(broadcastInterval);
      await message.reply({ message: '🔴 Broadcast DINONAKTIFKAN.' });
      break;
    case 'status':
      await message.reply({ message: `📊 **STATUS**\nAktif: ${isAutoBcRunning}\nRelay: ${relayBots.length + 1}\nDelay: ${autoBcDelay} mnt\nDaftar Pesan: ${autoBcMessages.length}\nKutipan: ${quoteMessage ? 'Sedia' : 'Kosong'}` });
      break;
    case 'delay':
      const newDelay = parseInt(args[2]);
      if (newDelay > 0) {
        autoBcDelay = newDelay;
        await message.reply({ message: `⏱️ Delay diatur ke ${newDelay} menit.` });
      }
      break;
    case 'remove':
      autoBcMessages = [];
      quoteMessage = null;
      await message.reply({ message: '🗑️ Semua data broadcast dibersihkan.' });
      break;
  }
}

// ==========================================
// 🏁 6. MAIN EXECUTION
// ==========================================
async function main() {
  await loginOwner();
  console.log('🚀 System Online. Menunggu command dari Telegram...');
  
  // Agar proses tidak mati di Pterodactyl
  setInterval(() => {}, 1000 * 60 * 60);
}

main().catch(console.error);
