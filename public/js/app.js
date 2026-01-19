/* =================================================================================
   TCP SIMULATOR - APP.JS (V19 - Corruption & Integrity Check)
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
const chaosNodes = document.querySelectorAll(".chaos-stage .node-icon"); 

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
                case "PEER_LEFT": 
                    if(isChaosMode) toggleChaosMode(false, false);
                    mostrarModalDesconexao(); 
                    break;

                // CAOS SYNC
                case "CHAOS_SYNC": toggleChaosMode(msg.action === "OPEN", false); break;
                case "CHAOS_BURST":
                    const isIncoming = (msg.original_sender_id !== myId);
                    executarDisparoVisual(msg.qtd, isIncoming, msg.original_sender_id, msg.startSeq);
                    break;
                case "CHAOS_PAUSE": aplicarPausa(msg.is_paused, msg.paused_by); break;
                case "CHAOS_EDIT": aplicarEdicaoRemota(msg); break;

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
function atualizarInspetor(p) { inspSeq.innerText=p.tcp_seq||0; inspAck.innerText=p.tcp_ack||0; inspLen.innerText=p.payload?p.payload.length:0; inspFlags.innerText=(p.type==="DATA")?"PSH":p.type; 
inspSport.innerText = p.tcp_sport || 0; inspDport.innerText = p.tcp_dport || 0;
}

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
// 4. LABORATÓRIO DE CAOS (V19 - Corruption)
// =========================================
let activePackets = [];   
let chaosLoopId = null;   
let burstSize = 5; 
let isChaosMode = false;
let isPaused = false;
let pausedBy = null; 
let isBursting = false; 

// Sequência
let myNextChaosSeq = 1000; 
let outgoingQueue = []; 
let incomingQueue = []; 
let lastOutTime = 0;
let lastInTime = 0;
const SPAWN_INTERVAL = 1500; 

class ChaosPacket {
    constructor(seq, type = "DATA", isReverse = false, ownerId, isCorrupted = false) {
        this.id = "pkt_" + Math.random().toString(36).substr(2, 9);
        this.seq = seq;
        this.type = type;
        this.isReverse = isReverse; 
        this.ownerId = ownerId; 
        this.isCorrupted = isCorrupted; // Novo Estado

        this.tcp_sport = isReverse ? 80 : myRealPort;
        this.tcp_dport = isReverse ? myRealPort : 80;

        this.x = isReverse ? 95 : 0; 
        this.speed = 0.2; 
        
        this.el = document.createElement("div");
        this.el.className = `packet ${type}`; 
        
        // Aplica classes visuais
        if (ownerId !== myId) this.el.classList.add("peer");
        if (isCorrupted) this.el.classList.add("corrupted");

        this.el.innerText = seq;
        this.updatePos();
        chaosPacketLayer.appendChild(this.el);
    }
    updatePos() { this.el.style.left = this.x + "%"; this.el.style.top = "8px"; }
    
    move() {
        let arrived = false;
        if (this.isReverse) { 
            if (this.x > 0) { this.x -= this.speed; this.updatePos(); } else { arrived = true; }
        } else { 
            if (this.x < 95) { this.x += this.speed; this.updatePos(); } else { arrived = true; }
        }
        if (arrived) {
            // CORREÇÃO: Passa o estado de corrupção para o flash
            triggerNodeFlash(this.isReverse, this.isCorrupted);
            return false;
        }
        return true; 
    }
    
    // Novo método para alternar corrupção
    toggleCorruption() {
        this.isCorrupted = !this.isCorrupted;
        if(this.isCorrupted) this.el.classList.add("corrupted");
        else this.el.classList.remove("corrupted");
    }

    kill() { this.el.remove(); }
}

function triggerNodeFlash(isReverse, isCorrupted) {
    const nodeIndex = isReverse ? 0 : 1; 
    
    // Se estiver corrompido, usa animação de ERRO, independente da direção
    let animationClass = isCorrupted ? "anim-error" : (isReverse ? "anim-receive" : "anim-success");

    if (chaosNodes[nodeIndex]) {
        const node = chaosNodes[nodeIndex];
        node.classList.remove("anim-success", "anim-receive", "anim-error"); 
        void node.offsetWidth; node.classList.add(animationClass);
    }
}

function requestToggleChaos() { toggleChaosMode(!isChaosMode, true); }

function toggleChaosMode(ativar, emitirAviso = false) {
    if (isChaosMode === ativar) return;
    isChaosMode = ativar;
    if (isChaosMode) {
        chaosScreen.style.display = "flex";
        if(workspaceDiv) workspaceDiv.style.display = "none"; 
        
        isPaused = false; pausedBy = null; isBursting = false;
        activePackets = []; outgoingQueue = []; incomingQueue = []; 
        
        btnPauseToggle.disabled = false;
        updateFireButtonState();
        startChaosLoop();
    } else {
        chaosScreen.style.display = "none";
        if(workspaceDiv) workspaceDiv.style.display = "block"; 
        
        cancelAnimationFrame(chaosLoopId);
        chaosLoopId = null;
        activePackets.forEach(p => p.kill());
        activePackets = []; outgoingQueue = []; incomingQueue = [];
        
        isPaused = false; pausedBy = null; isBursting = false;
        chaosEditorArea.classList.add("hidden"); chaosEditorArea.classList.remove("blocked");
        activePacketList.innerHTML = ""; chaosPacketLayer.innerHTML = "";
        chaosNodes.forEach(n => n.classList.remove("anim-success", "anim-receive", "anim-error"));
        updateFireButtonState();
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
    
    updateFireButtonState(); 
    
    if (isPaused) {
        btnPauseToggle.className = (pausedBy === myId) ? "btn-pause btn-play" : "btn-pause";
        btnPauseToggle.style.backgroundColor = (pausedBy === myId) ? "#3fb950" : "#57606a";
        btnPauseToggle.innerHTML = (pausedBy === myId) ? "▶️ CONTINUAR (Você Pausou)" : "🔒 PARCEIRO EDITANDO...";
        btnPauseToggle.disabled = (pausedBy !== myId);

        chaosEditorArea.classList.remove("hidden");
        if (pausedBy === myId) {
            chaosEditorArea.classList.remove("blocked");
            renderEditor();
        } else {
            chaosEditorArea.classList.add("blocked");
            activePacketList.innerHTML = ""; 
        }
    } else {
        btnPauseToggle.className = "btn-pause";
        btnPauseToggle.style.backgroundColor = "#da3633";
        btnPauseToggle.innerHTML = "✋ PAUSAR TUDO";
        btnPauseToggle.disabled = false;

        chaosEditorArea.classList.add("hidden");
        chaosEditorArea.classList.remove("blocked");
        startChaosLoop(); 
    }
}

function updateFireButtonState() {
    if (!btnFireBurst) return;
    if (!isPaused && !isBursting) {
        btnFireBurst.disabled = false;
        btnFireBurst.innerText = "DISPARAR";
        btnFireBurst.style.opacity = "1";
    } else {
        btnFireBurst.disabled = true;
        btnFireBurst.style.opacity = "0.5";
        if (isBursting) btnFireBurst.innerText = "AGUARDANDO CHEGADA...";
        else if (isPaused) btnFireBurst.innerText = "PAUSADO";
    }
}

// --- EDITOR ---
function renderEditor() {
    activePacketList.innerHTML = "";
    if(activePackets.length === 0) { activePacketList.innerHTML = '<div class="empty-msg">Sem pacotes no fio.</div>'; return; }
    
    activePackets.forEach((pkt, index) => {
        const card = document.createElement("div"); 
        const isMine = (pkt.ownerId === myId);
        card.className = isMine ? "packet-card" : "packet-card is-peer";
        
        let actionButtons = "";
        if (isMine) {
            actionButtons = `
                <button class="btn-icon" onclick="swapPacket(${index}, -1)" title="Trás">⬆️</button>
                <button class="btn-icon" onclick="swapPacket(${index}, 1)" title="Frente">⬇️</button>
                <button class="btn-icon btn-dup" onclick="duplicatePacket(${index})" title="Duplicar">📑</button>
                <button class="btn-icon btn-kill" onclick="deletePacket(${index})" title="Excluir">❌</button>
                <button class="btn-icon btn-corrupt" onclick="corruptPacket(${index})" title="Corromper (Bits)">⚡</button>
            `;
        } else {
            actionButtons = `<span style="font-size:0.8rem; color: #8b949e; font-style: italic;">🔒 (Parceiro)</span>`;
        }
        card.innerHTML = `
            <div class="packet-info"><span>📦 SEQ ${pkt.seq}</span><span class="packet-progress">${Math.round(pkt.x)}%</span></div>
            <div class="packet-actions">${actionButtons}</div>`;
        activePacketList.appendChild(card);
    });
}

function deletePacket(index) { 
    if (!activePackets[index]) return; if (activePackets[index].ownerId !== myId) return; 
    activePackets[index].kill(); activePackets.splice(index, 1); notifyEdit("DELETE", index); renderEditor(); 
}
function duplicatePacket(index) {
    if (!activePackets[index]) return; if (activePackets[index].ownerId !== myId) return; 
    const org = activePackets[index];
    const clone = new ChaosPacket(org.seq, org.type, org.isReverse, org.ownerId, org.isCorrupted); 
    clone.x = org.x - 5; if(clone.x < 0) clone.x=0; clone.updatePos();
    activePackets.splice(index + 1, 0, clone); notifyEdit("DUPLICATE", index); renderEditor();
}
function swapPacket(index, direction) {
    const ti = index + direction; if (ti < 0 || ti >= activePackets.length) return;
    if (activePackets[index].ownerId !== myId) return; 
    const p1 = activePackets[index]; const p2 = activePackets[ti];
    const tx = p1.x; p1.x = p2.x; p2.x = tx; p1.updatePos(); p2.updatePos();
    activePackets[index] = p2; activePackets[ti] = p1; notifyEdit("SWAP", index, ti); renderEditor();
}

// NOVA FUNÇÃO DE CORRUPÇÃO
function corruptPacket(index) {
    if (!activePackets[index]) return;
    if (activePackets[index].ownerId !== myId) return;

    activePackets[index].toggleCorruption();
    notifyEdit("CORRUPT", index); // Notifica o parceiro
    // Não precisa renderEditor completo, mas vamos chamar para garantir consistência
    // (ou poderíamos apenas mudar o estilo do botão, mas o render é mais seguro)
}

function notifyEdit(a, i1, i2 = null) { if(ws && ws.readyState===1) ws.send(JSON.stringify({ type: "CHAOS_EDIT", action: a, idx1: i1, idx2: i2 })); }
function aplicarEdicaoRemota(msg) {
    if (msg.action === "DELETE") { if(activePackets[msg.idx1]) { activePackets[msg.idx1].kill(); activePackets.splice(msg.idx1, 1); } }
    else if (msg.action === "DUPLICATE") { 
        if(activePackets[msg.idx1]) { const o = activePackets[msg.idx1]; const c = new ChaosPacket(o.seq, o.type, o.isReverse, o.ownerId, o.isCorrupted); c.x=o.x-5; if(c.x<0)c.x=0; c.updatePos(); activePackets.splice(msg.idx1+1,0,c); }
    }
    else if (msg.action === "SWAP") {
        const p1 = activePackets[msg.idx1]; const p2 = activePackets[msg.idx2];
        if(p1 && p2) { const tx = p1.x; p1.x=p2.x; p2.x=tx; p1.updatePos(); p2.updatePos(); activePackets[msg.idx1] = p2; activePackets[msg.idx2] = p1; }
    }
    else if (msg.action === "CORRUPT") {
        // Aplica corrupção no pacote do parceiro
        if (activePackets[msg.idx1]) {
            activePackets[msg.idx1].toggleCorruption();
        }
    }
}

// --- LOOP & DISPARO ---
function startChaosLoop() {
    if (chaosLoopId) return;
    function loop() {
        if (!isPaused) {
            const now = Date.now();
            
            // 1. Saída (Meus)
            if (outgoingQueue.length > 0) {
                if (now - lastOutTime > SPAWN_INTERVAL) {
                    const nextPkt = outgoingQueue.shift();
                    const pkt = new ChaosPacket(nextPkt.seq, nextPkt.type, nextPkt.isReverse, nextPkt.ownerId, nextPkt.isCorrupted);
                    activePackets.push(pkt);
                    lastOutTime = now;
                }
            }

            // 2. Entrada (Parceiro)
            if (incomingQueue.length > 0) {
                if (now - lastInTime > SPAWN_INTERVAL) {
                    const nextPkt = incomingQueue.shift();
                    const pkt = new ChaosPacket(nextPkt.seq, nextPkt.type, nextPkt.isReverse, nextPkt.ownerId, nextPkt.isCorrupted);
                    activePackets.push(pkt);
                    lastInTime = now;
                }
            }

            // 3. Move
            for (let i = activePackets.length - 1; i >= 0; i--) {
                const pkt = activePackets[i];
                const vivo = pkt.move();
                if (!vivo) { pkt.kill(); activePackets.splice(i, 1); }
            }

            // 4. Auto-Unlock
            if (isBursting) {
                const myActive = activePackets.filter(p => p.ownerId === myId).length;
                const myPending = outgoingQueue.length;
                if (myActive === 0 && myPending === 0) {
                    isBursting = false;
                    updateFireButtonState();
                }
            }
        }
        chaosLoopId = requestAnimationFrame(loop);
    }
    loop();
}

function dispararRajada() {
    if(isPaused || isBursting) return; 
    
    isBursting = true;
    updateFireButtonState();
    
    const startSeq = myNextChaosSeq;

    atualizarInspetor({
        tcp_seq: startSeq,
        tcp_ack: 0,
        tcp_sport: myRealPort,
        tcp_dport: 80,
        type: "DATA",
        payload: "[RAJADA]"
    });

    if(ws && ws.readyState===1) {
        ws.send(JSON.stringify({ 
            type: "CHAOS_BURST", 
            qtd: burstSize, 
            original_sender_id: myId,
            startSeq: startSeq 
        }));
    }
    
    myNextChaosSeq += (100 * burstSize);
    executarDisparoVisual(burstSize, false, myId, startSeq);
}

function executarDisparoVisual(qtd, isReverse = false, ownerId, startSeq) {
    let currentSeqForLoop = startSeq;

    for (let i = 0; i < qtd; i++) {
        // IMPORTANTE: isCorrupted começa false por padrão
        const payload = { seq: currentSeqForLoop, type: "DATA", isReverse: isReverse, ownerId: ownerId, isCorrupted: false };
        
        if (isReverse) incomingQueue.push(payload); 
        else outgoingQueue.push(payload);
        
        currentSeqForLoop += 100; 
    }
    
    startChaosLoop();
}

function mudarQtdRajada(qtd, btnElement) { burstSize = qtd; document.querySelectorAll('.btn-opt').forEach(b => b.classList.remove('selected')); btnElement.classList.add('selected'); }

conectarWS();