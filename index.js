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

// GANTI API ID & HASH ANDA DISINI
const OWNER_API_ID = 29798494; 
const OWNER_API_HASH = '53273c1de3e68a9ecdb90de2dcf46f6c';

let config = {
    autoBcDelay: 5,
    autoBcMessages: [],
    blacklist: [],
    forwardMode: false,
    forwardSource: null,
    autoBcRunning: false,
    debugMode: false
};

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        const loadedConfig = JSON.parse(data);
        config = { ...config, ...loadedConfig };
        console.log('✅ Konfigurasi dimuat');
    } catch (err) {
        console.error('❌ Error membaca config:', err.message);
    }
}

let OWNER_SESSION_STRING = "";
if (fs.existsSync(SESSION_FILE)) {
    try {
        OWNER_SESSION_STRING = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    } catch (err) {
        console.error('❌ Error membaca session:', err.message);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('❌ Error saving config:', err.message);
    }
}

function saveSession(sessionString) {
    try {
        fs.writeFileSync(SESSION_FILE, sessionString);
    } catch (err) {
        console.error('❌ Error saving session:', err.message);
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
            console.log('✅ Terhubung (Saved Session)');
        } else {
            console.log('📱 Login diperlukan:');
            await ownerClient.start({
                phoneNumber: async () => await input.text('📞 Nomor HP: '),
                password: async () => await input.text('🔑 Password 2FA: '),
                phoneCode: async () => await input.text('📲 Kode OTP: '),
                onError: (err) => console.log('❌ Login Error:', err.message),
            });
        }

        const me = await ownerClient.getMe();
        console.log(`✅ Login sukses: ${me.firstName} (${me.id})`);
        
        const sessionString = ownerClient.session.save();
        if (sessionString !== OWNER_SESSION_STRING) {
            saveSession(sessionString);
            OWNER_SESSION_STRING = sessionString;
        }

        isConnected = true;
        setupOwnerHandler(ownerClient);
        
        if (config.autoBcRunning) {
            startAutoBroadcast();
            console.log('🔄 Broadcast Resume');
        }
        
        return true;
    } catch (err) {
        console.error('❌ GAGAL LOGIN:', err.message);
        if (OWNER_SESSION_STRING && (err.message.includes('SESSION') || err.message.includes('AUTH'))) {
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
            await msg.reply({ message: `
🛠 **BOT COMMANDS**

**.autobc on/off** - Nyalakan/Matikan BC
**.autobc status** - Cek status & mode
**.autobc delay 5** - Set delay 5 menit

**.setmsg** (reply) - Set pesan yg mau di-forward (WAJIB REPLY)
**.forward on/off** - Mode forward pesan / teks biasa

**.addtext** (reply) - Tambah teks biasa
**.listtext** - List teks biasa
**.removetext 1** - Hapus teks no 1

**.addbl** - Blacklist grup ini (skip)
**.unbl** - Hapus blacklist
**.listbl** - Cek blacklist
            `});
            return;
        }

        // --- BLACKLIST ---
        if (text === '.addbl') {
            if (!config.blacklist.includes(chatIdStr)) {
                config.blacklist.push(chatIdStr);
                saveConfig();
                await msg.reply({ message: '⛔ Grup di-Blacklist (Skip BC).' });
            } else {
                await msg.reply({ message: '⚠️ Sudah di blacklist.' });
            }
            return;
        }

        if (text === '.unbl') {
            config.blacklist = config.blacklist.filter(id => id !== chatIdStr);
            saveConfig();
            await msg.reply({ message: '✅ Grup dihapus dari Blacklist.' });
            return;
        }

        if (text === '.listbl') {
            await msg.reply({ message: `📋 Blacklist: ${config.blacklist.length} grup` });
            return;
        }

        // --- FORWARD & MSG ---
        if (text === '.forward on') {
            if (!config.forwardSource) return msg.reply({ message: '⚠️ Set pesan dulu pake **.setmsg** (reply pesan)' });
            config.forwardMode = true;
            saveConfig();
            await msg.reply({ message: '↪️ Mode Forward: ON' });
            return;
        }

        if (text === '.forward off') {
            config.forwardMode = false;
            saveConfig();
            await msg.reply({ message: '📝 Mode Forward: OFF (Pakai Text)' });
            return;
        }

        // PERBAIKAN UTAMA DI SINI (Menggunakan chatId, bukan peerId)
        if (text === '.setmsg' && msg.replyTo) {
            const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
            if (reply && reply[0]) {
                config.forwardSource = {
                    id: reply[0].id,
                    // FIX: Gunakan chatId.toString() agar tidak jadi [object Object]
                    peerId: reply[0].chatId.toString(), 
                    preview: reply[0].message ? reply[0].message.substring(0, 30) : "Media/Sticker"
                };
                saveConfig();
                await msg.reply({ message: '✅ Pesan Sumber Disimpan!\nID: ' + config.forwardSource.peerId });
            }
            return;
        }

        if (args[0] === '.addtext' && msg.replyTo) {
            const reply = await client.getMessages(msg.peerId, { ids: msg.replyTo.replyToMsgId });
            if (reply && reply[0] && reply[0].message) {
                config.autoBcMessages.push(reply[0].message);
                saveConfig();
                await msg.reply({ message: `✅ Teks disimpan. Total: ${config.autoBcMessages.length}` });
            }
            return;
        }

        if (text === '.listtext') {
            let t = config.autoBcMessages.map((m, i) => `${i+1}. ${m.substring(0,30)}...`).join('\n');
            await msg.reply({ message: t || 'Kosong' });
            return;
        }

        if (text.startsWith('.autobc')) await handleAutoBcCommand(msg, client, args);

    }, new NewMessage({}));
}

// ==========================================
// 🚀 5. BROADCAST LOGIC (FIXED)
// ==========================================
async function performBroadcastCycle() {
    if (!config.autoBcRunning || !ownerClient || !isConnected) return;
    
    console.log('📢 Broadcast Cycle Start...');
    
    try {
        const dialogs = await ownerClient.getDialogs({ limit: 200 });
        const groups = dialogs.filter(d => {
            const isGroup = d.isGroup || (d.entity && d.entity.className === 'Channel' && d.entity.megagroup);
            const isChannel = d.isChannel && !d.entity.megagroup;
            const isBl = config.blacklist.includes(d.id.toString());
            return isGroup && !isChannel && !isBl;
        });

        console.log(`🎯 Target: ${groups.length} grup`);
        if (groups.length === 0) return;

        for (const group of groups) {
            if (!config.autoBcRunning) break;

            try {
                // Efek Mengetik (Safe Mode)
                try {
                    if (group.inputEntity) {
                        await ownerClient.invoke(new Api.messages.SetTyping({
                            peer: group.inputEntity,
                            action: new Api.SendMessageTypingAction()
                        }));
                        await sleep(3000); 
                    }
                } catch (e) { /* Ignore typing error */ }

                console.log(`📤 Sending to: ${group.title || group.name}`);

                if (config.forwardMode && config.forwardSource) {
                    // FIX: Pastikan Peer ID valid (BigInt)
                    const sourcePeer = BigInt(config.forwardSource.peerId); 
                    await ownerClient.forwardMessages(group.id, {
                        messages: [config.forwardSource.id],
                        fromPeer: sourcePeer 
                    });
                } else if (!config.forwardMode && config.autoBcMessages.length > 0) {
                    const rndMsg = config.autoBcMessages[Math.floor(Math.random() * config.autoBcMessages.length)];
                    await ownerClient.sendMessage(group.id, { message: rndMsg });
                } else {
                    console.log('⚠️ Belum ada pesan/forward source.');
                }

                await sleep(5000); // Delay antar grup

            } catch (err) {
                console.log(`❌ Error ${group.title}: ${err.message}`);
                if (err.message.includes('FLOOD')) {
                    const s = parseInt(err.message.match(/\d+/)[0]) || 60;
                    console.log(`⏳ FloodWait ${s}s...`);
                    await sleep(s * 1000);
                }
            }
        }
        console.log('✅ Cycle Done.');
    } catch (err) {
        console.error('❌ Cycle Error:', err.message);
    }
}

async function handleAutoBcCommand(msg, client, args) {
    const sub = args[1] ? args[1].toLowerCase() : '';
    if (sub === 'on') {
        config.autoBcRunning = true; saveConfig(); startAutoBroadcast();
        await msg.reply({ message: '🟢 BC ON' });
    } else if (sub === 'off') {
        config.autoBcRunning = false; saveConfig(); 
        if (broadcastInterval) clearInterval(broadcastInterval);
        await msg.reply({ message: '🔴 BC OFF' });
    } else if (sub === 'status') {
        await msg.reply({ message: `Status: ${config.autoBcRunning ? 'ON' : 'OFF'}\nMode Forward: ${config.forwardMode}\nDelay: ${config.autoBcDelay}m` });
    } else if (sub === 'delay' && args[2]) {
        config.autoBcDelay = parseInt(args[2]); saveConfig();
        await msg.reply({ message: `⏱ Delay: ${args[2]} menit` });
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function startAutoBroadcast() {
    if (broadcastInterval) clearInterval(broadcastInterval);
    broadcastInterval = setInterval(performBroadcastCycle, config.autoBcDelay * 60000);
    setTimeout(performBroadcastCycle, 5000);
}

// Keep Alive
async function keepAlive() {
    if (!ownerClient || !isConnected) {
        try { if(ownerClient) await ownerClient.disconnect(); await loginOwner(); } catch(e){}
    } else {
        try { await ownerClient.getMe(); } catch(e) { isConnected = false; }
    }
}

// Main
async function main() {
    console.log('🤖 Starting...');
    if(await loginOwner()) setInterval(keepAlive, 180000);
    else setTimeout(main, 10000);
}

process.on('SIGINT', () => process.exit(0));
main().catch(console.error);
