const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const { Api } = require('telegram/tl/api');

// ==========================================
// 📁 2. KONFIGURASI & PERSISTENSI
// ==========================================
const CONFIG_FILE = 'bot_config.json';
const SESSION_FILE = 'owner_session.txt';

// GANTI API ID & HASH ANDA DISINI JIKA PERLU
const OWNER_API_ID = 29798494; 
const OWNER_API_HASH = '53273c1de3e68a9ecdb90de2dcf46f6c';

// Load konfigurasi dari file
let config = {
    autoBcDelay: 5,
    autoBcMessages: [],     // Untuk mode teks biasa
    blacklist: [],          // Daftar ID grup yang di-skip
    forwardMode: false,     // Status mode forward
    forwardSource: null,    // Menyimpan ID pesan untuk di-forward {id, peerId}
    autoBcRunning: false,
    debugMode: false
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        const loadedConfig = JSON.parse(data);
        // Merge config untuk memastikan field baru (blacklist/forward) ada
        config = { ...config, ...loadedConfig };
        console.log('✅ Konfigurasi dimuat dari file');
    } catch (err) {
        console.error('❌ Error membaca config:', err.message);
    }
}

// Load session dari file
let OWNER_SESSION_STRING = "";
if (fs.existsSync(SESSION_FILE)) {
    try {
        OWNER_SESSION_STRING = fs.readFileSync(SESSION_FILE, 'utf8').trim();
        console.log('✅ Session dimuat dari file');
    } catch (err) {
        console.error('❌ Error membaca session:', err.message);
    }
}

// Fungsi save konfigurasi
function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        // console.log('💾 Konfigurasi disimpan'); // Uncomment jika ingin log setiap save
    } catch (err) {
        console.error('❌ Error menyimpan config:', err.message);
    }
}

// Fungsi save session
function saveSession(sessionString) {
    try {
        fs.writeFileSync(SESSION_FILE, sessionString);
        console.log('🔑 Session disimpan ke file');
    } catch (err) {
        console.error('❌ Error menyimpan session:', err.message);
    }
}

let ownerClient = null;
let broadcastInterval = null;
let isConnected = false;

// ==========================================
// 🔑 3. FUNGSI LOGIN
// ==========================================
async function loginOwner() {
    console.log('🔑 Mencoba Login OWNER...');
    const stringSession = new StringSession(OWNER_SESSION_STRING);
    
    ownerClient = new TelegramClient(stringSession, OWNER_API_ID, OWNER_API_HASH, {
        connectionRetries: 5,
        useWSS: false,
        timeout: 30000
    });

    try {
        if (OWNER_SESSION_STRING) {
            await ownerClient.connect();
            console.log('✅ Terhubung menggunakan session yang tersimpan');
        } else {
            console.log('📱 Login diperlukan, silakan masukkan informasi:');
            await ownerClient.start({
                phoneNumber: async () => await input.text('📞 Nomor HP: '),
                password: async () => await input.text('🔑 Password 2FA (jika ada): '),
                phoneCode: async () => await input.text('📲 Kode OTP: '),
                onError: (err) => console.log('❌ Login Error:', err.message),
            });
        }

        const me = await ownerClient.getMe();
        console.log('✅ Berhasil Login sebagai: ' + me.firstName + ' (ID: ' + me.id + ')');
        
        const sessionString = ownerClient.session.save();
        if (sessionString !== OWNER_SESSION_STRING) {
            saveSession(sessionString);
            OWNER_SESSION_STRING = sessionString;
        }

        isConnected = true;
        setupOwnerHandler(ownerClient);
        
        if (config.autoBcRunning) {
            startAutoBroadcast();
            console.log('🔄 Broadcast diaktifkan ulang');
        }
        
        return true;
    } catch (err) {
        console.error('❌ GAGAL LOGIN:', err.message);
        if (OWNER_SESSION_STRING && (err.message.includes('SESSION_REVOKED') || err.message.includes('AUTH_KEY'))) {
            console.log('⚠️ Session tidak valid, menghapus dan mencoba login ulang...');
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            OWNER_SESSION_STRING = "";
            return await loginOwner();
        }
        return false;
    }
}

// ==========================================
// 🎯 4. HANDLER PERINTAH
// ==========================================
function setupOwnerHandler(client) {
    client.addEventHandler(async (event) => {
        const msg = event.message;
        if (!msg.out || !msg.text) return;

        const text = msg.text.trim();
        const args = text.split(/\s+/);
        const chatIdStr = msg.chatId.toString();

        if (text === '.help' || text === '/help') {
            const helpText = `
👑 **COMMAND LIST BARU**

**Broadcast Control:**
.autobc on - Aktifkan broadcast
.autobc off - Matikan broadcast
.autobc status - Cek status/mode
.autobc delay <menit> - Atur jeda waktu

**Mode Forward & Pesan:**
.setmsg (reply) - **PENTING!** Set pesan untuk di-forward
.forward on - Aktifkan mode forward (pakai pesan .setmsg)
.forward off - Matikan mode forward (pakai pesan teks biasa)

**Pesan Teks Biasa (Jika Forward OFF):**
.addtext (reply) - Tambah pesan teks biasa
.listtext - Lihat daftar pesan teks
.removetext <nomor> - Hapus pesan teks

**Blacklist Group:**
.addbl - Skip grup ini saat broadcast
.unbl - Izinkan grup ini lagi
.listbl - Lihat daftar ID blacklist

**System:**
.me - Info akun
.ping - Cek koneksi
.debug on/off
            `;
            await msg.reply({ message: helpText });
            return;
        }

        // --- BLACKLIST COMMANDS ---
        if (text === '.addbl') {
            if (!config.blacklist.includes(chatIdStr)) {
                config.blacklist.push(chatIdStr);
                saveConfig();
                await msg.reply({ message: '⛔ Grup ini berhasil dimasukkan ke **Blacklist**.\nBot tidak akan promosi di sini.' });
            } else {
                await msg.reply({ message: '⚠️ Grup ini sudah ada di Blacklist.' });
            }
            return;
        }

        if (text === '.unbl') {
            if (config.blacklist.includes(chatIdStr)) {
                config.blacklist = config.blacklist.filter(id => id !== chatIdStr);
                saveConfig();
                await msg.reply({ message: '✅ Grup ini dihapus dari Blacklist.\nBot akan promosi di sini lagi.' });
            } else {
                await msg.reply({ message: '⚠️ Grup ini tidak ada di Blacklist.' });
            }
            return;
        }

        if (text === '.listbl') {
            await msg.reply({ message: `📋 **Blacklist Groups**\nTotal: ${config.blacklist.length} grup.` });
            return;
        }

        // --- FORWARD MODE COMMANDS ---
        if (text === '.forward on') {
            if (!config.forwardSource) {
                await msg.reply({ message: '⚠️ **Gagal!** Anda belum mengatur pesan sumber.\nSilakan reply pesan promosi Anda dengan **.setmsg** terlebih dahulu.' });
                return;
            }
            config.forwardMode = true;
            saveConfig();
            await msg.reply({ message: '↪️ **Mode Forward: ON**\nBroadcast akan meneruskan pesan (forward) dari pesan yang disimpan.' });
            return;
        }

        if (text === '.forward off') {
            config.forwardMode = false;
            saveConfig();
            await msg.reply({ message: '📝 **Mode Forward: OFF**\nBroadcast akan mengirim pesan sebagai teks biasa (dari .addtext).' });
            return;
        }

        // Set pesan sumber untuk forward (PENGGANTI ADDKUTIP)
        if (text === '.setmsg' && msg.replyTo) {
            const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
            if (reply && reply[0]) {
                // Simpan ID pesan dan Peer ID (chat asalnya)
                config.forwardSource = {
                    id: reply[0].id,
                    peerId: reply[0].peerId.toString(), // Simpan ID chat asal
                    preview: reply[0].message ? reply[0].message.substring(0, 30) : "Media/Sticker"
                };
                saveConfig();
                await msg.reply({ message: '✅ **Pesan Sumber Disimpan!**\nGunakan `.forward on` untuk mulai mem-forward pesan ini ke grup lain.' });
            }
            return;
        }

        // --- STANDARD TEXT COMMANDS ---
        if (args[0] === '.addtext' && msg.replyTo) {
            const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
            if (reply && reply[0] && reply[0].message) {
                config.autoBcMessages.push(reply[0].message);
                saveConfig();
                await msg.reply({ message: `✅ Teks ditambahkan (Mode Forward OFF).\nTotal: ${config.autoBcMessages.length} pesan` });
            }
            return;
        }

        if (args[0] === '.listtext') {
            if (config.autoBcMessages.length === 0) {
                await msg.reply({ message: '📭 Tidak ada pesan teks.' });
                return;
            }
            let listText = '📋 **DAFTAR PESAN TEKS**\n\n';
            config.autoBcMessages.forEach((msgText, index) => {
                listText += `${index + 1}. ${msgText.substring(0, 50)}...\n`;
            });
            await msg.reply({ message: listText });
            return;
        }

        if (args[0] === '.removetext' && args[1]) {
            const index = parseInt(args[1]) - 1;
            if (index >= 0 && index < config.autoBcMessages.length) {
                config.autoBcMessages.splice(index, 1);
                saveConfig();
                await msg.reply({ message: '🗑️ Pesan teks dihapus.' });
            }
            return;
        }

        // --- UTILS ---
        if (text === '.ping') {
            const start = Date.now();
            const sent = await msg.reply({ message: '🏓 Pong!' });
            const latency = Date.now() - start;
            await client.editMessage(msg.chatId, { 
                message: sent.id, 
                text: `🏓 Pong!\n⏱️ Latency: ${latency}ms`
            });
            return;
        }

        if (text.startsWith('.autobc')) {
            await handleAutoBcCommand(msg, client, args);
        }

    }, new NewMessage({}));
}

// ==========================================
// 🚀 5. LOGIKA BROADCAST (Grup + Blacklist + Typing + Forward)
// ==========================================
async function performBroadcastCycle() {
    if (!config.autoBcRunning || !ownerClient || !isConnected) return;
    
    console.log('📢 Menjalankan Broadcast Cycle...');
    
    try {
        const dialogs = await ownerClient.getDialogs({ limit: 200 });
        
        // Filter: Hanya Grup & Bukan Blacklist
        const groups = dialogs.filter(dialog => {
            const isGroup = dialog.isGroup || (dialog.entity && dialog.entity.className === 'Channel' && dialog.entity.megagroup);
            const isChannel = dialog.isChannel && !dialog.entity.megagroup;
            
            // Cek Blacklist
            const isBlacklisted = config.blacklist.includes(dialog.id.toString());
            
            return (isGroup && !isChannel && !isBlacklisted);
        });
        
        console.log(`📌 Target: ${groups.length} grup (Blacklist di-skip)`);
        
        if (groups.length === 0) return;
        
        for (let i = 0; i < groups.length; i++) {
            if (!config.autoBcRunning) break;
            
            const group = groups[i];
            
            try {
                // 1. Kirim Action "Typing..." (Mengetik) selama 3 detik
                // Menggunakan try-catch khusus agar jika typing gagal, pesan tetap terkirim
                try {
                    await ownerClient.invoke(new Api.messages.SetTyping({
                        peer: group.inputEntity || group.id,
                        action: new Api.SendMessageTypingAction()
                    }));
                    await sleep(3000); // Tunggu 3 detik seolah-olah mengetik
                } catch (typeErr) {
                    // Ignore error typing (kadang inputEntity belum cache)
                }

                console.log(`📤 [${i + 1}/${groups.length}] Sending to: ${group.title}`);

                // 2. Kirim Pesan Berdasarkan Mode
                if (config.forwardMode && config.forwardSource) {
                    // --- MODE FORWARD (Pesan Terusan) ---
                    // Kita harus mengambil entity sumber dulu agar bisa di-forward
                    // Menggunakan ID chat asal dan ID pesan yang disimpan di .setmsg
                    await ownerClient.forwardMessages(group.id, {
                        messages: [config.forwardSource.id],
                        fromPeer: config.forwardSource.peerId // ID Chat asal pesan
                    });
                    console.log('   ↪️ Forwarded message');

                } else {
                    // --- MODE TEKS BIASA ---
                    if (config.autoBcMessages.length > 0) {
                        const randomMsg = config.autoBcMessages[Math.floor(Math.random() * config.autoBcMessages.length)];
                        await ownerClient.sendMessage(group.id, { 
                            message: randomMsg,
                            parseMode: 'html'
                        });
                        console.log('   📝 Sent text message');
                    } else {
                        console.log('   ⚠️ Tidak ada pesan teks/forward source belum diset.');
                    }
                }
                
                // Delay antar grup (mencegah flood)
                await sleep(5000); 
                
            } catch (err) {
                console.log(`   ❌ Skip ${group.title}: ${err.message}`);
                // Jika kena flood wait, istirahat agak lama
                if (err.message.includes('FLOOD_WAIT')) {
                    const waitTime = parseInt(err.message.match(/\d+/)[0]);
                    console.log(`   ⏳ Kena FloodWait, tidur ${waitTime} detik...`);
                    await sleep(waitTime * 1000);
                }
            }
        }
        console.log('✅ Broadcast cycle selesai');
        
    } catch (err) {
        console.error('❌ Error cycle:', err.message);
    }
}

async function handleAutoBcCommand(message, client, args) {
    const subCmd = args[1] ? args[1].toLowerCase() : null;

    switch(subCmd) {
        case 'on':
            config.autoBcRunning = true;
            saveConfig();
            startAutoBroadcast();
            await message.reply({ message: '🟢 Broadcast **AKTIF**' });
            break;
        case 'off':
            config.autoBcRunning = false;
            saveConfig();
            if (broadcastInterval) clearInterval(broadcastInterval);
            await message.reply({ message: '🔴 Broadcast **MATI**' });
            break;
        case 'status':
            const statusMsg = `
📊 **STATUS BOT**
• Status: ${config.autoBcRunning ? '🟢 RUNNING' : '🔴 STOPPED'}
• Delay: ${config.autoBcDelay} menit
• Mode Forward: ${config.forwardMode ? '✅ ON' : '❌ OFF'}
• Pesan Teks: ${config.autoBcMessages.length}
• Blacklist: ${config.blacklist.length} grup
• Source Forward: ${config.forwardSource ? '✅ Ada' : '❌ Kosong'}
            `;
            await message.reply({ message: statusMsg });
            break;
        case 'delay':
            if (args[2]) {
                config.autoBcDelay = parseInt(args[2]);
                saveConfig();
                if (config.autoBcRunning) startAutoBroadcast();
                await message.reply({ message: `⏱️ Delay diubah ke ${args[2]} menit` });
            }
            break;
        case 'remove':
            config.autoBcMessages = [];
            config.forwardSource = null;
            saveConfig();
            await message.reply({ message: '🗑️ Semua data pesan & forward source dihapus.' });
            break;
        default:
            await message.reply({ message: '❌ Perintah salah. Cek .help' });
    }
}

// Helper
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function startAutoBroadcast() {
    if (broadcastInterval) clearInterval(broadcastInterval);
    broadcastInterval = setInterval(performBroadcastCycle, config.autoBcDelay * 60 * 1000);
    // Jalankan segera setelah 5 detik
    setTimeout(performBroadcastCycle, 5000);
    console.log(`⏰ Jadwal set: tiap ${config.autoBcDelay} menit`);
}

// Keep Alive & Reconnect Logic
async function keepAlive() {
    if (!ownerClient || !isConnected) {
        try {
            if (ownerClient) await ownerClient.disconnect();
            await loginOwner();
        } catch (e) { console.log('Reconnecting...'); }
    } else {
        try { await ownerClient.getMe(); } 
        catch (e) { isConnected = false; }
    }
}

// Main
async function main() {
    console.log('🤖 Bot Starting...');
    const success = await loginOwner();
    if (!success) {
        setTimeout(main, 10000);
        return;
    }
    setInterval(keepAlive, 3 * 60 * 1000);
}

process.on('SIGINT', async () => {
    config.autoBcRunning = false;
    saveConfig();
    if (ownerClient) await ownerClient.disconnect();
    process.exit(0);
});

main().catch(console.error);
