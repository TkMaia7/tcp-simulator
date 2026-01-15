/* =================================================================================
   TCP SIMULATOR - APP.JS (V11 - Spawn Queue System)
   ================================================================================= */

let ws;
const myId = "CLIENT_" + Math.floor(Math.random() * 10000);
let tcpState = "CLOSED";
let currentRoom = null;
let myRole = "GUEST"; 

const myRealPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
let currentSeq = Math.floor(Math.random() * 1000) + 100; 
let currentAck = 0; 

// --- Elementos DOM ---
const lobbyScreen = document.getElementById("lobby-screen");
const workspaceScreen = document.getElementById("workspace-screen");
const roomNameInput = document.getElementById("room-name");
const roomPassInput = document.getElementById("room-pass");
const lobbyMsg = document.getElementById("lobby-msg");
const listaSalasContainer = document.getElementById("lista-salas-container");
const workspaceDiv = document.querySelector(".main-container"); 

// --- Elementos Simulador ---
const packetLayer = document.getElementById("packet-layer");
const miniLog = document.getElementById("mini-log");
const msgInput = document.getElementById("msg-input");
const btnSend = document.getElementById("btn-send-data");
const btnHandshake = document.getElementById("btn-handshake"); 
const btnFin = document.getElementById("btn-fin"); 
const chatWindow = document.getElementById("chat-window");
const statusBadge = document.getElementById("status-client");
const remoteBadge = document.getElementById("status-server");
const wireLine = document.getElementById("wire-line");
const displayMyPort = document.getElementById("display-my-port");
const msgAguardando = document.getElementById("msg-aguardando");

// --- Elementos Inspetor ---
const inspSport = document.getElementById("insp-sport");
const inspDport = document.getElementById("insp-dport");
const inspSeq = document.getElementById("insp-seq");
const inspAck = document.getElementById("insp-ack");
const inspLen = document.getElementById("insp-len");
const inspFlags = document.getElementById("insp-flags");
const inspPayload = document.getElementById("insp-payload");
const btnOpenChaos = document.getElementById("btn-open-chaos"); 

// --- Chaos Lab ---
const chaosScreen = document.getElementById("chaos-screen");
const btnPauseToggle = document.getElementById("btn-pause-toggle");
const btnFireBurst = document.getElementById("btn-fire-burst");
const chaosPacketLayer = document.getElementById("chaos-packet-layer");
const activePacketList = document.getElementById("active-packet-list");
const chaosEditorArea = document.getElementById("chaos-editor-area");

// Estado Inicial
if(btnOpenChaos) btnOpenChaos.disabled = true; 

// =========================================
// 1. CONEXÃO
// =========================================
function conectarWS() {
    if(displayMyPort) displayMyPort.innerText = `Porta: ${myRealPort}`;
    const host = window.location.hostname;
    const url = (window.location.protocol === 'https:') ? `wss://${host}/ws` : `ws://${host||"localhost"}:8000`;

    ws = new WebSocket(url);

    ws.onopen = () => { lobbyMsg.innerText = "Conectado. Carregando salas..."; lobbyMsg.style.color = "#3fb950"; };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
                case "ROOM_LIST": renderizarListaSalas(msg.rooms); break;
                case "ROOM_ACCEPTED":
                    entrarNoSimulador(msg.room_id);
                    myRole = msg.role;
                    if (msg.role === "HOST") {
                        logSistema("Sala criada (HOST).");
                        atualizarStatusTopo("Aguardando P2...", "#e3b341");
                    } else {
                        logSistema("Entrou como GUEST.");
                        notificarConexaoEstabelecida();
                    }
                    break;
                case "ERROR": mostrarErroLobby(msg.message); break;
                case "PEER_JOINED": logSistema("Parceiro entrou!"); notificarConexaoEstabelecida(); break;
                case "PEER_LEFT": mostrarModalDesconexao(); break;

                // CAOS SYNC
                case "CHAOS_SYNC": toggleChaosMode(msg.action === "OPEN", false); break;
                case "CHAOS_BURST":
                    const isIncoming = (msg.original_sender_id !== myId);
                    executarDisparoVisual(msg.qtd, isIncoming);
                    break;
                case "CHAOS_PAUSE":
                    aplicarPausa(msg.is_paused, msg.paused_by);
                    break;
                case "CHAOS_EDIT":
                    aplicarEdicaoRemota(msg);
                    break;

                default: if (msg.original_sender_id !== myId) animarRecebimento(msg);
            }
        } catch (e) { console.error(e); }
    };
    ws.onerror = () => mostrarErroLobby("Erro de Conexão com o servidor.");
}

// =========================================
// 2. LOBBY & TCP
// =========================================
function renderizarListaSalas(salas) {
    listaSalasContainer.innerHTML = "";
    if (salas.length === 0) { listaSalasContainer.innerHTML = '<div class="empty-msg">Nenhuma sala criada.</div>'; return; }
    salas.forEach(sala => {
        const div = document.createElement("div"); div.className = "room-item";
        div.innerHTML = `<span class="room-item-name">${sala}</span><span class="room-item-action">Selecionar</span>`;
        div.onclick = () => { roomNameInput.value = sala; roomPassInput.focus(); lobbyMsg.innerText = `Sala "${sala}" selecionada.`; lobbyMsg.style.color = "#58a6ff"; };
        listaSalasContainer.appendChild(div);
    });
}
function criarSala() { if(validarWS()) ws.send(JSON.stringify({type: "CREATE_ROOM", room_id: roomNameInput.value, password: roomPassInput.value})); }
function entrarSala() { if(validarWS()) ws.send(JSON.stringify({type: "JOIN_ROOM", room_id: roomNameInput.value, password: roomPassInput.value})); }
function validarWS() { if(!ws || ws.readyState!==1) { mostrarErroLobby("Sem conexão."); return false;} return true; }
function mostrarErroLobby(m) { lobbyMsg.innerText=m; lobbyMsg.style.color="#ff7b72"; }
function entrarNoSimulador(id) { currentRoom = id; lobbyScreen.style.display="none"; workspaceScreen.style.display="block"; document.getElementById("display-room-name").innerText = id; }

function processarRecebimento(pacote) {
    pacote.tcp_seq = Number(pacote.tcp_seq); pacote.tcp_ack = Number(pacote.tcp_ack);
    atualizarInspetor(pacote);
    logSistema(`RX [${pacote.type}] SEQ=${pacote.tcp_seq}`);
    let len = (pacote.payload) ? pacote.payload.length : 0;
    if (pacote.type === "SYN" || pacote.type === "FIN" || pacote.type === "SYN-ACK") len = 1;
    if (!isNaN(pacote.tcp_seq)) currentAck = pacote.tcp_seq + len;
    
    if(tcpState==="CLOSED" && pacote.type==="SYN") { mudarEstado("SYN_RCVD"); setTimeout(()=>enviarPacote("SYN-ACK"),1000); }
    else if(tcpState==="SYN_SENT" && pacote.type==="SYN-ACK") { currentSeq++; mudarEstado("ESTABLISHED"); setTimeout(()=>enviarPacote("ACK"),1000); }
    else if(tcpState==="SYN_RCVD" && pacote.type==="ACK") mudarEstado("ESTABLISHED");
    else if(tcpState==="ESTABLISHED") {
        if(pacote.type==="DATA") adicionarNoChat(pacote.payload, "received");
        if(pacote.type==="FIN") { mudarEstado("CLOSE_WAIT"); setTimeout(()=>{ enviarPacote("ACK"); setTimeout(()=>{ mudarEstado("LAST_ACK"); enviarPacote("FIN"); },1500); },500); }
    }
    else if(tcpState==="FIN_WAIT_1" && (pacote.type==="ACK"||pacote.type==="FIN")) { if(pacote.type==="FIN") enviarPacote("ACK"); mudarEstado("FIN_WAIT_2"); }
    else if(tcpState==="LAST_ACK" && pacote.type==="ACK") resetarLocalmente();
}

function enviarPacote(tipo, payload = "") {
    let seq = currentSeq; let ack = currentAck;
    if (tipo === "SYN" || tipo === "FIN") ack = 0;
    if (tipo === "DATA") currentSeq += payload.length;
    if (tipo === "SYN" || tipo === "FIN") currentSeq++; 
    const pacote = { type: tipo, original_sender_id: myId, payload: payload, tcp_seq: seq, tcp_ack: ack, tcp_sport: myRealPort, tcp_dport: 80 };
    atualizarInspetor(pacote); criarElementoPacote(tipo, "right");
    if(ws && ws.readyState===1) ws.send(JSON.stringify(pacote));
}

function mudarEstado(novo) {
    tcpState = novo; statusBadge.innerText = novo; statusBadge.className = `status-badge ${novo}`;
    if (novo === "ESTABLISHED") {
        wireLine.classList.add("connected"); remoteBadge.innerText = "ESTABLISHED"; remoteBadge.className="status-badge ESTABLISHED";
        msgInput.disabled=false; btnSend.disabled=false; btnFin.disabled=false; btnHandshake.disabled=true;
        msgInput.placeholder="Digite mensagem..."; if(msgAguardando) msgAguardando.style.display="none"; 
        btnOpenChaos.disabled = false; 
    } else if (novo === "CLOSED") {
        btnHandshake.disabled=false; btnFin.disabled=true; btnOpenChaos.disabled = true; 
        if(isChaosMode) toggleChaosMode(false, true); 
    } else {
        btnHandshake.disabled=true; btnFin.disabled=true; msgInput.disabled=true; btnSend.disabled=true; btnOpenChaos.disabled = true;
    }
}

function iniciarHandshake() { if (tcpState === "CLOSED") { mudarEstado("SYN_SENT"); enviarPacote("SYN"); } }
function iniciarFin() { if (tcpState === "ESTABLISHED") { mudarEstado("FIN_WAIT_1"); enviarPacote("FIN"); } }
function enviarMensagem() { if(msgInput.value){ adicionarNoChat(msgInput.value, "sent"); enviarPacote("DATA", msgInput.value); msgInput.value=""; msgInput.focus(); } }
function resetarLocalmente() { mudarEstado("CLOSED"); wireLine.classList.remove("connected"); remoteBadge.innerText = "LISTENING"; remoteBadge.className="status-badge"; currentSeq=100; currentAck=0; logSistema("Reset."); atualizarInspetor({type:"-",tcp_seq:0,tcp_ack:0,payload:""}); }

// Helpers
function atualizarInspetor(p) { inspSeq.innerText=p.tcp_seq||0; inspAck.innerText=p.tcp_ack||0; inspLen.innerText=p.payload?p.payload.length:0; inspFlags.innerText=(p.type==="DATA")?"PSH":p.type; }
function adicionarNoChat(m,t) { chatWindow.innerHTML+=`<div class="chat-msg msg-${t}">${m}</div>`; chatWindow.scrollTop=chatWindow.scrollHeight; }
function logSistema(m) { miniLog.innerText=`> ${m}`; }
function animarRecebimento(p) { criarElementoPacote(p.type, "left"); setTimeout(()=>processarRecebimento(p), 1500); }
function criarElementoPacote(t,d) { const el=document.createElement("div"); el.className=`packet ${t} ${d==="right"?"anim-right":"anim-left"}`; el.innerText=t; packetLayer.appendChild(el); setTimeout(()=>el.remove(), 1600); }
function atualizarStatusTopo(t,c) { const e=document.getElementById("display-status"); e.innerText=t; e.style.color=c; }
function notificarConexaoEstabelecida() { atualizarStatusTopo("Parceiro Conectado", "#3fb950"); }
function mostrarModalDesconexao() { document.getElementById("modal-overlay").style.display="flex"; atualizarStatusTopo("Parceiro Saiu", "#ff7b72"); }
function voltarLobby() { location.reload(); }
function reiniciarSala() { document.getElementById("modal-overlay").style.display="none"; resetarLocalmente(); atualizarStatusTopo("Aguardando...", "#e3b341"); }

// =========================================
// 4. LABORATÓRIO DE CAOS (V11 - Spawn Queue)
// =========================================
let activePackets = [];   
let chaosLoopId = null;   
let nextSeqNum = 100;     
let burstSize = 5; 
let isChaosMode = false;
let isPaused = false;
let pausedBy = null; 

// --- NOVA ESTRUTURA DE FILA ---
let spawnQueue = []; 
let lastSpawnTime = 0; 
const SPAWN_INTERVAL = 1500; // Tempo entre pacotes

class ChaosPacket {
    constructor(seq, type = "DATA", isReverse = false) {
        this.id = "pkt_" + Math.random().toString(36).substr(2, 9);
        this.seq = seq;
        this.type = type;
        this.isReverse = isReverse; 
        this.x = isReverse ? 95 : 0; 
        this.speed = 0.2; 
        
        this.el = document.createElement("div");
        this.el.className = `packet ${type}`; 
        this.el.innerText = seq;
        this.updatePos();
        chaosPacketLayer.appendChild(this.el);
    }
    updatePos() { this.el.style.left = this.x + "%"; this.el.style.top = "8px"; }
    move() {
        if (this.isReverse) { if (this.x > 0) { this.x -= this.speed; this.updatePos(); return true; } } 
        else { if (this.x < 95) { this.x += this.speed; this.updatePos(); return true; } }
        return false;
    }
    kill() { this.el.remove(); }
}

function requestToggleChaos() { toggleChaosMode(!isChaosMode, true); }

function toggleChaosMode(ativar, emitirAviso = false) {
    if (isChaosMode === ativar) return;
    isChaosMode = ativar;
    if (isChaosMode) {
        chaosScreen.style.display = "flex";
        if(workspaceDiv) workspaceDiv.style.display = "none"; 
        
        isPaused = false;
        pausedBy = null;
        atualizarBotaoPause();
        
        startChaosLoop();
    } else {
        chaosScreen.style.display = "none";
        if(workspaceDiv) workspaceDiv.style.display = "block"; 
        
        cancelAnimationFrame(chaosLoopId);
        chaosLoopId = null;
        
        // Limpa tudo (Pacotes e Fila Pendente)
        activePackets.forEach(p => p.kill());
        activePackets = [];
        spawnQueue = []; 
        
        isPaused = false; pausedBy = null;
        chaosEditorArea.classList.add("hidden"); chaosEditorArea.classList.remove("blocked");
        activePacketList.innerHTML = ""; chaosPacketLayer.innerHTML = "";
        atualizarBotaoPause();
    }
    if (emitirAviso && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "CHAOS_SYNC", action: isChaosMode ? "OPEN" : "CLOSE", original_sender_id: myId }));
    }
}
if(btnOpenChaos) btnOpenChaos.onclick = requestToggleChaos;

// --- PAUSA GLOBAL ---
function requestPauseToggle() {
    if (isPaused && pausedBy !== myId) return;
    const novoEstado = !isPaused;
    if(ws && ws.readyState===1) {
        ws.send(JSON.stringify({ type: "CHAOS_PAUSE", is_paused: novoEstado, paused_by: myId }));
    }
    aplicarPausa(novoEstado, myId);
}
btnPauseToggle.onclick = requestPauseToggle;

function aplicarPausa(estado, quemPausou) {
    isPaused = estado;
    pausedBy = quemPausou;
    atualizarBotaoPause();

    if (isPaused) {
        chaosEditorArea.classList.remove("hidden");
        if (pausedBy === myId) {
            chaosEditorArea.classList.remove("blocked");
            renderEditor();
        } else {
            chaosEditorArea.classList.add("blocked");
            activePacketList.innerHTML = ""; 
        }
    } else {
        chaosEditorArea.classList.add("hidden");
        chaosEditorArea.classList.remove("blocked");
        startChaosLoop(); 
    }
}

function atualizarBotaoPause() {
    if (isPaused) {
        if(btnFireBurst) btnFireBurst.disabled = true; // Trava disparo
        if (pausedBy === myId) {
            btnPauseToggle.innerHTML = "▶️ CONTINUAR (Você Pausou)";
            btnPauseToggle.className = "btn-pause btn-play";
            btnPauseToggle.style.backgroundColor = "#3fb950";
            btnPauseToggle.disabled = false;
        } else {
            btnPauseToggle.innerHTML = "🔒 PARCEIRO EDITANDO...";
            btnPauseToggle.className = "btn-pause";
            btnPauseToggle.style.backgroundColor = "#57606a";
            btnPauseToggle.disabled = true;
        }
    } else {
        if(btnFireBurst) btnFireBurst.disabled = false; // Destrava disparo
        btnPauseToggle.innerHTML = "✋ PAUSAR TUDO";
        btnPauseToggle.className = "btn-pause";
        btnPauseToggle.style.backgroundColor = "#da3633";
        btnPauseToggle.disabled = false;
    }
}

// --- EDITOR ---
function renderEditor() {
    activePacketList.innerHTML = "";
    if(activePackets.length === 0) { activePacketList.innerHTML = '<div class="empty-msg">Sem pacotes no fio.</div>'; return; }

    activePackets.forEach((pkt, index) => {
        const card = document.createElement("div");
        card.className = "packet-card";
        card.innerHTML = `
            <div class="packet-info">
                <span>📦 SEQ ${pkt.seq}</span>
                <span class="packet-progress">${Math.round(pkt.x)}%</span>
            </div>
            <div class="packet-actions">
                <button class="btn-icon" onclick="swapPacket(${index}, -1)" title="Mover Trás">⬆️</button>
                <button class="btn-icon" onclick="swapPacket(${index}, 1)" title="Mover Frente">⬇️</button>
                <button class="btn-icon btn-dup" onclick="duplicatePacket(${index})" title="Duplicar">📑</button>
                <button class="btn-icon btn-kill" onclick="deletePacket(${index})" title="Excluir">❌</button>
            </div>
        `;
        activePacketList.appendChild(card);
    });
}

function deletePacket(index) {
    if (!activePackets[index]) return;
    activePackets[index].kill(); activePackets.splice(index, 1);
    notifyEdit("DELETE", index); renderEditor();
}
function duplicatePacket(index) {
    if (!activePackets[index]) return;
    const original = activePackets[index];
    const clone = new ChaosPacket(original.seq, original.type, original.isReverse);
    clone.x = original.x - 5; if(clone.x < 0) clone.x=0; clone.updatePos();
    activePackets.splice(index + 1, 0, clone);
    notifyEdit("DUPLICATE", index); renderEditor();
}
function swapPacket(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= activePackets.length) return;
    const p1 = activePackets[index]; const p2 = activePackets[targetIndex];
    const tempX = p1.x; p1.x = p2.x; p2.x = tempX; p1.updatePos(); p2.updatePos();
    activePackets[index] = p2; activePackets[targetIndex] = p1;
    notifyEdit("SWAP", index, targetIndex); renderEditor();
}

function notifyEdit(action, idx1, idx2 = null) {
    if(ws && ws.readyState===1) ws.send(JSON.stringify({ type: "CHAOS_EDIT", action: action, idx1: idx1, idx2: idx2 }));
}
function aplicarEdicaoRemota(msg) {
    if (msg.action === "DELETE") { if(activePackets[msg.idx1]) { activePackets[msg.idx1].kill(); activePackets.splice(msg.idx1, 1); } }
    else if (msg.action === "DUPLICATE") { 
        if(activePackets[msg.idx1]) {
            const org = activePackets[msg.idx1]; const cln = new ChaosPacket(org.seq, org.type, org.isReverse);
            cln.x = org.x-5; if(cln.x<0) cln.x=0; cln.updatePos();
            activePackets.splice(msg.idx1+1,0,cln);
        }
    }
    else if (msg.action === "SWAP") {
        const p1 = activePackets[msg.idx1]; const p2 = activePackets[msg.idx2];
        if(p1 && p2) {
            const tx = p1.x; p1.x=p2.x; p2.x=tx; p1.updatePos(); p2.updatePos();
            activePackets[msg.idx1] = p2; activePackets[msg.idx2] = p1;
        }
    }
}

// --- LOOP & DISPARO (Correção Timeouts) ---
function startChaosLoop() {
    if (chaosLoopId) return;
    function loop() {
        if (!isPaused) {
            const now = Date.now();

            // 1. Processa Nascimento (Spawn Queue) - SUBSTITUI OS TIMEOUTS
            if (spawnQueue.length > 0) {
                // Se já passou o tempo necessário desde o último spawn
                if (now - lastSpawnTime > SPAWN_INTERVAL) {
                    const nextPkt = spawnQueue.shift();
                    const pkt = new ChaosPacket(nextPkt.seq, nextPkt.type, nextPkt.isReverse);
                    activePackets.push(pkt);
                    lastSpawnTime = now;
                }
            }

            // 2. Processa Movimento
            for (let i = activePackets.length - 1; i >= 0; i--) {
                const pkt = activePackets[i];
                const vivo = pkt.move();
                if (!vivo) { pkt.kill(); activePackets.splice(i, 1); }
            }
        }
        chaosLoopId = requestAnimationFrame(loop);
    }
    loop();
}

function dispararRajada() {
    if(isPaused) return; 
    if(ws && ws.readyState===1) ws.send(JSON.stringify({ type: "CHAOS_BURST", qtd: burstSize, original_sender_id: myId }));
    executarDisparoVisual(burstSize, false);
}

function executarDisparoVisual(qtd, isReverse = false) {
    btnPauseToggle.disabled = false;
    
    // Apenas enfileira os pedidos. O loop cuida de criar no tempo certo.
    for (let i = 0; i < qtd; i++) {
        spawnQueue.push({
            seq: nextSeqNum,
            type: "DATA",
            isReverse: isReverse
        });
        nextSeqNum += 100; 
    }
    startChaosLoop();
}

function mudarQtdRajada(qtd, btnElement) { burstSize = qtd; document.querySelectorAll('.btn-opt').forEach(b => b.classList.remove('selected')); btnElement.classList.add('selected'); }

conectarWS();