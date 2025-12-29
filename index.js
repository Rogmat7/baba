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

const OWNER_API_ID = 29798494; 
const OWNER_API_HASH = '53273c1de3e68a9ecdb90de2dcf46f6c';

// Load konfigurasi dari file
let config = {
    autoBcDelay: 5,
    autoBcMessages: [],
    autoBcRunning: false,
    relayBots: [],
    debugMode: false
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        config = JSON.parse(data);
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
        console.log('💾 Konfigurasi disimpan');
    } catch (err) {
        console.error('❌ Error menyimpan config:', err.message);
    }
}

// Fungsi save session
function saveSession(sessionString) {
    try {
        fs.writeFileSync(SESSION_FILE, sessionString);
        console.log('🔐 Session disimpan ke file');
    } catch (err) {
        console.error('❌ Error menyimpan session:', err.message);
    }
}

let ownerClient = null;
let quoteMessage = null;
let broadcastInterval = null;
let isConnected = false;

// ==========================================
// 🔐 3. FUNGSI LOGIN dengan Auto-Save Session
// ==========================================
async function loginOwner() {
    console.log('🔐 Mencoba Login OWNER...');
    const stringSession = new StringSession(OWNER_SESSION_STRING);
    
    ownerClient = new TelegramClient(stringSession, OWNER_API_ID, OWNER_API_HASH, {
        connectionRetries: 5,
        useWSS: false, // Nonaktifkan WSS untuk koneksi lebih stabil
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
                password: async () => await input.text('🔐 Password 2FA (jika ada): '),
                phoneCode: async () => await input.text('📲 Kode OTP: '),
                onError: (err) => console.log('❌ Login Error:', err.message),
            });
        }

        const me = await ownerClient.getMe();
        console.log('✅ Berhasil Login sebagai: ' + me.firstName + ' (ID: ' + me.id + ')');
        
        // Simpan session ke file
        const sessionString = ownerClient.session.save();
        if (sessionString !== OWNER_SESSION_STRING) {
            saveSession(sessionString);
            OWNER_SESSION_STRING = sessionString;
        }

        isConnected = true;
        setupOwnerHandler(ownerClient);
        
        // Restart broadcast jika sebelumnya aktif
        if (config.autoBcRunning) {
            startAutoBroadcast();
            console.log('🔄 Broadcast diaktifkan ulang');
        }
        
        return true;
    } catch (err) {
        console.error('❌ GAGAL LOGIN:', err.message);
        
        // Jika session tidak valid, hapus dan coba login manual
        if (OWNER_SESSION_STRING && (err.message.includes('SESSION_REVOKED') || err.message.includes('AUTH_KEY'))) {
            console.log('⚠️ Session tidak valid, menghapus dan mencoba login ulang...');
            if (fs.existsSync(SESSION_FILE)) {
                fs.unlinkSync(SESSION_FILE);
            }
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

        if (text === '.help' || text === '/help') {
            const helpText = `
👑 **COMMAND LIST**

**Broadcast Control:**
.autobc on - Aktifkan broadcast
.autobc off - Matikan broadcast
.autobc status - Lihat status
.autobc delay <menit> - Set delay (contoh: .autobc delay 10)
.autobc remove - Hapus semua pesan

**Pesan Management:**
.addkutip (reply) - Simpan pesan sebagai kutipan
.addtext (reply) - Tambah pesan teks
.listtext - Lihat daftar pesan teks
.removetext <nomor> - Hapus pesan tertentu

**Debug & Info:**
.me - Info akun
.ping - Cek koneksi
.debug on/off - Mode debug
.listgroups - Lihat daftar grup
            `;
            await msg.reply({ message: helpText });
            return;
        }

        if (text === '.me' || text === '/me') {
            try {
                const me = await client.getMe();
                await msg.reply({ 
                    message: `👤 **Info Akun**\nNama: ${me.firstName}\nID: ${me.id}\nUsername: @${me.username || 'tidak ada'}`
                });
            } catch (err) {
                console.error(err);
            }
            return;
        }

        if (text === '.ping' || text === '/ping') {
            const start = Date.now();
            await msg.reply({ message: '🏓 Pong!' });
            const latency = Date.now() - start;
            await client.editMessage(msg.chatId, { 
                message: msg.id + 1, 
                text: `🏓 Pong!\n⏱️ Latency: ${latency}ms\nStatus: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}`
            });
            return;
        }

        if (args[0] === '.debug') {
            if (args[1] === 'on') {
                config.debugMode = true;
                saveConfig();
                await msg.reply({ message: '🔧 Debug mode: ON' });
            } else if (args[1] === 'off') {
                config.debugMode = false;
                saveConfig();
                await msg.reply({ message: '🔧 Debug mode: OFF' });
            } else {
                await msg.reply({ message: `Debug mode: ${config.debugMode ? 'ON' : 'OFF'}` });
            }
            return;
        }

        if (args[0] === '.listgroups' || args[0] === '/listgroups') {
            try {
                await msg.reply({ message: '⏳ Mengambil daftar grup...' });
                
                const dialogs = await client.getDialogs({ limit: 100 });
                const groups = [];
                
                dialogs.forEach(dialog => {
                    if (dialog.isGroup || (dialog.entity && 
                        (dialog.entity.className === 'Chat' || 
                         dialog.entity.className === 'Channel' && dialog.entity.megagroup))) {
                        groups.push({
                            title: dialog.title || dialog.name || 'Unknown',
                            id: dialog.id,
                            type: dialog.entity.className,
                            participants: dialog.entity.participantsCount || 0
                        });
                    }
                });
                
                let response = `📋 **DAFTAR GRUP**\n\n`;
                if (groups.length === 0) {
                    response += '❌ Tidak ada grup ditemukan\n';
                    response += 'Pastikan Anda sudah join beberapa grup!';
                } else {
                    groups.forEach((group, index) => {
                        response += `${index + 1}. ${group.title}\n`;
                        response += `   👥 ${group.participants} members | Type: ${group.type}\n\n`;
                    });
                    response += `\nTotal: ${groups.length} grup ditemukan`;
                }
                
                await client.editMessage(msg.chatId, {
                    message: msg.id + 1,
                    text: response
                });
                
            } catch (err) {
                console.error(err);
                await msg.reply({ message: '❌ Error: ' + err.message });
            }
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

        if (args[0] === '.addtext' && msg.replyTo) {
            const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
            if (reply && reply[0] && reply[0].message) {
                config.autoBcMessages.push(reply[0].message);
                saveConfig();
                await msg.reply({ 
                    message: `✅ Pesan teks ditambahkan.\nTotal: ${config.autoBcMessages.length} pesan`
                });
            }
            return;
        }

        if (args[0] === '.listtext' || args[0] === '/listtext') {
            if (config.autoBcMessages.length === 0) {
                await msg.reply({ message: '📭 Tidak ada pesan teks tersimpan.' });
                return;
            }
            
            let listText = '📋 **DAFTAR PESAN TEKS**\n\n';
            config.autoBcMessages.forEach((msgText, index) => {
                const preview = msgText.length > 50 ? msgText.substring(0, 50) + '...' : msgText;
                listText += `${index + 1}. ${preview}\n\n`;
            });
            listText += `\nTotal: ${config.autoBcMessages.length} pesan`;
            await msg.reply({ message: listText });
            return;
        }

        if (args[0] === '.removetext' && args[1]) {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= config.autoBcMessages.length) {
                await msg.reply({ message: '❌ Nomor tidak valid!' });
                return;
            }
            
            const removed = config.autoBcMessages.splice(index, 1);
            saveConfig();
            await msg.reply({ 
                message: `✅ Pesan #${index + 1} dihapus.\nSisa: ${config.autoBcMessages.length} pesan`
            });
            return;
        }

        if (text.startsWith('.autobc')) {
            await handleAutoBcCommand(msg, client);
        }
    }, new NewMessage({}));
}

// ==========================================
// 🚀 5. LOGIKA BROADCAST (Hanya ke Grup)
// ==========================================
async function performBroadcastCycle() {
    if (!config.autoBcRunning || !ownerClient || !isConnected) {
        console.log('⚠️ Broadcast tidak aktif atau client tidak terhubung');
        return;
    }
    
    console.log('📢 Menjalankan Broadcast Cycle...');
    
    try {
        // Ambil semua dialog
        const dialogs = await ownerClient.getDialogs({ limit: 200 });
        
        if (config.debugMode) {
            console.log('🔍 Total dialog:', dialogs.length);
            dialogs.forEach((dialog, idx) => {
                console.log(`${idx + 1}. ${dialog.title || dialog.name} - ${dialog.entity ? dialog.entity.className : 'Unknown'} - ${dialog.isGroup ? 'Group' : 'Not Group'}`);
            });
        }
        
        // Filter hanya grup (termasuk megagroup/supergroup)
        const groups = dialogs.filter(dialog => {
            // Cek berbagai jenis grup
            const isGroup = dialog.isGroup;
            const isMegagroup = dialog.entity && dialog.entity.className === 'Channel' && dialog.entity.megagroup;
            const isChat = dialog.entity && dialog.entity.className === 'Chat';
            
            // Exclude channel pribadi/broadcast
            const isChannel = dialog.isChannel && !dialog.entity.megagroup;
            
            // Hanya ambil yang grup atau megagroup
            return (isGroup || isMegagroup || isChat) && !isChannel;
        });
        
        console.log(`📍 Ditemukan ${groups.length} grup`);
        
        if (groups.length === 0) {
            console.log('⚠️ Tidak ada grup ditemukan. Gunakan .listgroups untuk debug');
            return;
        }
        
        // Kirim ke setiap grup
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            
            if (!config.autoBcRunning) {
                console.log('⏹️ Broadcast dihentikan');
                break;
            }
            
            try {
                const groupName = group.title || group.name || 'Unknown Group';
                console.log(`📤 [${i + 1}/${groups.length}] Mengirim ke: ${groupName}`);
                
                if (quoteMessage) {
                    // Kirim sebagai forward
                    await ownerClient.forwardMessages(group.id, {
                        messages: [quoteMessage.id],
                        fromPeer: quoteMessage.peerId,
                    });
                    console.log('  ↪️ Mengirim kutipan');
                } else if (config.autoBcMessages.length > 0) {
                    // Pilih pesan teks acak
                    const randomMsg = config.autoBcMessages[
                        Math.floor(Math.random() * config.autoBcMessages.length)
                    ];
                    
                    await ownerClient.sendMessage(group.id, { 
                        message: randomMsg,
                        parseMode: 'html'
                    });
                    console.log('  📝 Mengirim teks');
                } else {
                    console.log('  ⚠️ Tidak ada pesan untuk dikirim');
                    continue;
                }
                
                // Delay antara pengiriman
                await sleep(5000); // 5 detik delay
                
            } catch (err) {
                console.log(`  ❌ Error pada grup ${group.title || 'Unknown'}: ${err.message}`);
                
                // Skip grup jika error tertentu
                if (err.message.includes('CHAT_WRITE_FORBIDDEN') || 
                    err.message.includes('USER_BANNED') ||
                    err.message.includes('CHAT_ADMIN_REQUIRED')) {
                    console.log('  ⏭️ Skip grup ini (tidak bisa kirim)');
                }
                
                continue;
            }
        }
        
        console.log('✅ Broadcast cycle selesai');
        
    } catch (err) {
        console.error('❌ Error dalam broadcast cycle:', err.message);
        isConnected = false; // Tandai sebagai disconnect
    }
}

// Fungsi helper untuk delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi untuk memulai broadcast otomatis
function startAutoBroadcast() {
    if (broadcastInterval) {
        clearInterval(broadcastInterval);
    }
    
    broadcastInterval = setInterval(() => {
        performBroadcastCycle();
    }, config.autoBcDelay * 60 * 1000);
    
    // Jalankan segera setelah diaktifkan
    setTimeout(() => {
        performBroadcastCycle();
    }, 3000);
    
    console.log(`⏰ Broadcast dijadwalkan setiap ${config.autoBcDelay} menit`);
}

async function handleAutoBcCommand(message, client) {
    const args = message.text.split(/\s+/);
    const subCmd = args[1] ? args[1].toLowerCase() : null;

    // Jika reply tanpa subcommand, tambah sebagai teks
    if (!subCmd && message.replyTo) {
        const reply = await client.getMessages(message.peerId, { ids: message.replyTo.replyToMsgId });
        if (reply && reply[0] && reply[0].message) {
            config.autoBcMessages.push(reply[0].message);
            saveConfig();
            await message.reply({ 
                message: `✅ Pesan teks ditambahkan.\nTotal: ${config.autoBcMessages.length} pesan`
            });
        }
        return;
    }

    switch(subCmd) {
        case 'on':
            config.autoBcRunning = true;
            saveConfig();
            startAutoBroadcast();
            await message.reply({ 
                message: `🟢 Broadcast Aktif.\nDelay: ${config.autoBcDelay} menit\nPesan: ${config.autoBcMessages.length} teks\nStatus: Akan mulai dalam 3 detik`
            });
            break;
            
        case 'off':
            config.autoBcRunning = false;
            saveConfig();
            if (broadcastInterval) {
                clearInterval(broadcastInterval);
                broadcastInterval = null;
            }
            await message.reply({ message: '🔴 Broadcast Dimatikan.' });
            break;
            
        case 'status':
            const statusText = `
📊 **STATUS BROADCAST**

Status: ${config.autoBcRunning ? '🟢 AKTIF' : '🔴 MATI'}
Delay: ${config.autoBcDelay} menit
Pesan teks: ${config.autoBcMessages.length}
Kutipan: ${quoteMessage ? '✅ Ada' : '❌ Tidak ada'}
Koneksi: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}
Mode: Hanya Grup
Debug: ${config.debugMode ? 'ON' : 'OFF'}
            `;
            await message.reply({ message: statusText });
            break;
            
        case 'delay':
            if (args[2]) {
                const delay = parseInt(args[2]);
                if (delay >= 1 && delay <= 1440) {
                    config.autoBcDelay = delay;
                    saveConfig();
                    
                    if (config.autoBcRunning) {
                        startAutoBroadcast();
                    }
                    
                    await message.reply({ 
                        message: `⏰ Delay diubah menjadi ${delay} menit`
                    });
                } else {
                    await message.reply({ 
                        message: '❌ Delay harus antara 1-1440 menit (24 jam)'
                    });
                }
            } else {
                await message.reply({ 
                    message: `ℹ️ Delay saat ini: ${config.autoBcDelay} menit\nGunakan: .autobc delay <menit>`
                });
            }
            break;
            
        case 'remove':
            config.autoBcMessages = [];
            quoteMessage = null;
            saveConfig();
            await message.reply({ message: '🗑️ Semua data pesan dihapus.' });
            break;
            
        default:
            await message.reply({ 
                message: '❌ Perintah tidak dikenal.\nGunakan: .autobc on/off/status/delay/remove'
            });
    }
}

// ==========================================
// 🔄 6. AUTO ONLINE 24/7 & RECONNECT
// ==========================================
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

async function keepAlive() {
    if (!ownerClient || !isConnected) {
        console.log('⚠️ Client terputus, mencoba reconnect...');
        reconnectAttempts++;
        
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            try {
                // Coba reconnect
                if (ownerClient) {
                    await ownerClient.disconnect();
                }
                await loginOwner();
                reconnectAttempts = 0;
                console.log('✅ Reconnect berhasil');
            } catch (err) {
                console.error('❌ Reconnect gagal:', err.message);
            }
        } else {
            console.error('❌ Max reconnect attempts reached');
        }
    } else {
        // Lakukan ping sederhana untuk menjaga koneksi
        try {
            // Gunakan getMe sebagai ping alternative
            await ownerClient.getMe();
            console.log('🟢 Connection alive - ' + new Date().toLocaleTimeString());
        } catch (err) {
            console.log('⚠️ Ping failed:', err.message);
            isConnected = false;
        }
    }
}

// ==========================================
// 🚀 7. MAIN FUNCTION
// ==========================================
async function main() {
    console.log('🤖 Starting Telegram Broadcast Bot...');
    console.log('📅 ' + new Date().toLocaleString());
    
    // Login owner
    const loginSuccess = await loginOwner();
    if (!loginSuccess) {
        console.error('❌ Tidak bisa login, coba lagi dalam 10 detik...');
        setTimeout(main, 10000);
        return;
    }
    
    // Setup keep alive interval (setiap 3 menit)
    setInterval(keepAlive, 3 * 60 * 1000);
    
    // Jalankan keep alive pertama setelah 1 menit
    setTimeout(keepAlive, 60 * 1000);
    
    console.log('✅ Bot berjalan!');
    console.log('💡 Ketik .help untuk melihat command');
    console.log('🔧 Gunakan .listgroups untuk melihat daftar grup');
    
    // Keep process alive
    setInterval(() => {
        console.log('💓 Heartbeat - ' + new Date().toLocaleTimeString());
    }, 60 * 1000);
}

// Handle process exit
process.on('SIGINT', async () => {
    console.log('\n⚠️ Shutting down...');
    
    config.autoBcRunning = false;
    saveConfig();
    
    if (broadcastInterval) {
        clearInterval(broadcastInterval);
    }
    
    if (ownerClient && isConnected) {
        await ownerClient.disconnect();
    }
    
    console.log('✅ Bot dimatikan dengan aman');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Jalankan bot
main().catch(console.error);
