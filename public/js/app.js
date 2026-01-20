
// CONFIGURAÇÃO E ESTADO GLOBAL

// Identidade e Estado da Conexão TCP Padrão
let ws;
const myId = "CLIENT_" + Math.floor(Math.random() * 10000);
let tcpState = "CLOSED";
let currentRoom = null;
let myRole = "GUEST"; 

const myRealPort = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
let currentSeq = Math.floor(Math.random() * 1000) + 100; 
let currentAck = 0; 

// Configurações do Laboratório de Caos
const PACKET_SPEED = 0.4;      
const TIMEOUT_DURATION = 10000;

let simTime = 0;               
let isChaosMode = false;
let isPaused = false;
let pausedBy = null; 

let packets = [];             
let spawnQueue = [];          
let activePackets = packets;  
let myNextSeq = 1000;
let burstCount = 5;
let isBursting = false;       

let unackedData = {};         
let receivedLog = new Set();  
let chaosLoopId = null;

let receiverBuffer = {}; 
let nextExpectedSeq = 1000; 

// ELEMENTOS DO DOM

// Telas e Lobby
const lobbyScreen = document.getElementById("lobby-screen");
const workspaceScreen = document.getElementById("workspace-screen");
const roomNameInput = document.getElementById("room-name");
const roomPassInput = document.getElementById("room-pass");
const lobbyMsg = document.getElementById("lobby-msg");
const listaSalasContainer = document.getElementById("lista-salas-container");
const workspaceDiv = document.querySelector(".main-container"); 

// Simulador Padrão (Visual)
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

// Painel Inspetor
const inspSport = document.getElementById("insp-sport");
const inspDport = document.getElementById("insp-dport");
const inspSeq = document.getElementById("insp-seq");
const inspAck = document.getElementById("insp-ack");
const inspLen = document.getElementById("insp-len");
const inspFlags = document.getElementById("insp-flags");
const inspPayload = document.getElementById("insp-payload");
const btnOpenChaos = document.getElementById("btn-open-chaos"); 

// Laboratório de Caos (Interface)
const chaosScreen = document.getElementById("chaos-screen");
const btnPauseToggle = document.getElementById("btn-pause-toggle");
const btnFireBurst = document.getElementById("btn-fire-burst");
const chaosPacketLayer = document.getElementById("chaos-packet-layer");
const activePacketList = document.getElementById("active-packet-list");
const chaosEditorArea = document.getElementById("chaos-editor-area");
const chaosLogContainer = document.getElementById("chaos-log-container");
const chaosNodes = document.querySelectorAll(".chaos-stage .node-icon"); 

// Inicialização de Estado UI
if(btnOpenChaos) btnOpenChaos.disabled = true; 

// WEBSOCKET 

// Inicia a conexão WS e define o roteamento de todas as mensagens recebidas
function conectarWS() {
    if(displayMyPort) displayMyPort.innerText = `Porta: ${myRealPort}`;
    const host = window.location.hostname;
    const url = (window.location.protocol === 'https:') ? `wss://${host}/ws` : `ws://${host||"localhost"}:8000`;

    ws = new WebSocket(url);

    ws.onopen = () => { lobbyMsg.innerText = "Conectado. Carregando salas..."; lobbyMsg.style.color = "#3fb950"; };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.original_sender_id === myId) return;

            switch (msg.type) {
                // Mensagens de Lobby
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
                
                // Mensagens de Conexão P2P
                case "PEER_JOINED": logSistema("Parceiro entrou!"); notificarConexaoEstabelecida(); break;
                case "PEER_LEFT": 
                    if(isChaosMode) toggleChaosMode(false, false);
                    mostrarModalDesconexao(); 
                    break;

                // Mensagens do Laboratório de Caos
                case "CHAOS_SYNC": 
                    const action = msg.payload ? msg.payload.action : msg.action;
                    if(action === "OPEN") openChaosLab(false);
                    else closeChaosLab(false);
                    break;
                case "CHAOS_SPAWN": 
                    const pktData = msg.payload;
                    createVisualPacket({ 
                        id: pktData.id,
                        seq: pktData.seq, 
                        type: pktData.type, 
                        fromMe: false, 
                        ownerId: "PEER", 
                        x: 100, 
                        isCorrupted: pktData.isCorrupted 
                    });
                    break;
                case "CHAOS_PAUSE": aplicarPausa(msg.is_paused, msg.paused_by); break;
                case "CHAOS_EDIT": 
                case "EDIT":
                    const editData = msg.payload ? msg.payload : { action: msg.action, id: msg.id, idx1: msg.idx1, idx2: msg.idx2 };
                    aplicarEdicaoRemota(editData); 
                    break;
                case "CHAOS_BUFFER_SYNC":
                    renderBufferRemote(msg.payload.seqs);
                    break;

                // Mensagens Padrão (Simulador TCP Normal)
                default: if (msg.original_sender_id !== myId && !isChaosMode) animarRecebimento(msg);
            }
        } catch (e) { console.error(e); }
    };
    ws.onerror = () => mostrarErroLobby("Erro de Conexão com o servidor.");
}

// Envia mensagens de controle do modo Caos para o servidor
function notifyRemote(type, payload) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: type, original_sender_id: myId, payload: payload })); }

// Helper para validar estado do socket antes de enviar
function validarWS() { if(!ws || ws.readyState!==1) { mostrarErroLobby("Sem conexão."); return false;} return true; }

// SISTEMA DE LOBBY

// Atualiza a lista visual de salas no HTML
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

// Ações dos botões do Lobby
function criarSala() { if(validarWS()) ws.send(JSON.stringify({type: "CREATE_ROOM", room_id: roomNameInput.value, password: roomPassInput.value})); }
function entrarSala() { if(validarWS()) ws.send(JSON.stringify({type: "JOIN_ROOM", room_id: roomNameInput.value, password: roomPassInput.value})); }

// Feedback visual do Lobby
function mostrarErroLobby(m) { lobbyMsg.innerText=m; lobbyMsg.style.color="#ff7b72"; }

// Transição de tela Lobby / Simulador
function entrarNoSimulador(id) { currentRoom = id; lobbyScreen.style.display="none"; workspaceScreen.style.display="block"; document.getElementById("display-room-name").innerText = id; }

// SIMULADOR TCP PADRÃO 

// Máquina de estados que processa pacotes recebidos no modo normal
function processarRecebimento(pacote) {
    let seq = Number(pacote.tcp_seq); 
    atualizarInspetor(pacote);
    logSistema(`RX [${pacote.type}] SEQ=${seq}`);
    
    // Cálculo do ACK (
    let len = (pacote.payload) ? pacote.payload.length : 0;
    if (pacote.type === "SYN" || pacote.type === "FIN" || pacote.type === "SYN-ACK") len = 1;
    if (!isNaN(pacote.tcp_seq)) currentAck = pacote.tcp_seq + len;

    // HANDSHAKE PADRÃO
    if(tcpState==="CLOSED" && pacote.type==="SYN") { 
        mudarEstado("SYN_RCVD"); 
        setTimeout(()=>enviarPacote("SYN-ACK"),1000); 
    }
    
    // SIMULTANEOUS OPEN
    else if(tcpState==="SYN_SENT") {
        if (pacote.type==="SYN-ACK") { 
            currentSeq++; 
            mudarEstado("ESTABLISHED"); 
            setTimeout(()=>enviarPacote("ACK"),1000); 
        } 
        else if (pacote.type === "SYN") { 
            logSistema("Simultaneous Open detectado!");
            mudarEstado("SYN_RCVD");
            setTimeout(()=>enviarPacote("SYN-ACK"), 1000);
        }
    }

    // CONCLUSÃO SIMULTÂNEA
    else if(tcpState==="SYN_RCVD") {
        if (pacote.type==="ACK" || pacote.type==="SYN-ACK") { 
            mudarEstado("ESTABLISHED"); 
        }
    }

    // CONEXÃO ESTABELECIDA
    else if(tcpState==="ESTABLISHED") {
        if(pacote.type==="DATA") adicionarNoChat(pacote.payload, "received");
        if(pacote.type==="FIN") { 
            mudarEstado("CLOSE_WAIT"); 
            setTimeout(()=>{ 
                enviarPacote("ACK"); 
                setTimeout(()=>{ 
                    mudarEstado("LAST_ACK"); 
                    enviarPacote("FIN"); 
                },1500); 
            },500); 
        }
    }

    // ENCERRAMENTO ATIVO E SIMULTANEOUS CLOSE
    else if(tcpState==="FIN_WAIT_1") {
        if (pacote.type === "ACK") { 
            mudarEstado("FIN_WAIT_2"); 
        } 
        else if (pacote.type === "FIN") { 
            logSistema("Simultaneous Close detectado!");
            enviarPacote("ACK"); 
            mudarEstado("CLOSING"); 
        }
    }

    // ESTADOS FINAIS DE ENCERRAMENTO
    else if(tcpState==="FIN_WAIT_2" && pacote.type==="FIN") {
        enviarPacote("ACK"); 
        mudarEstado("TIME_WAIT");
        setTimeout(() => resetarLocalmente(), 2000); 
    }
    else if(tcpState==="LAST_ACK" && pacote.type==="ACK") { 
        resetarLocalmente(); 
    }
    
    else if (tcpState === "CLOSING" && pacote.type === "ACK") {
        mudarEstado("TIME_WAIT");
        setTimeout(() => resetarLocalmente(), 2000);
    }
}

// Envia pacote padrão e cria animação visual
function enviarPacote(tipo, payload = "") {
    let seq = currentSeq; let ack = currentAck;
    if (tipo === "SYN" || tipo === "FIN") ack = 0;
    if (tipo === "DATA") currentSeq += payload.length;
    if (tipo === "SYN" || tipo === "FIN") currentSeq++; 
    const pacote = { type: tipo, original_sender_id: myId, payload: payload, tcp_seq: seq, tcp_ack: ack, tcp_sport: myRealPort, tcp_dport: 80 };
    atualizarInspetor(pacote); criarElementoPacote(tipo, "right");
    if(ws && ws.readyState===1) ws.send(JSON.stringify(pacote));
}

// Gerencia a transição de estados TCP e habilita/desabilita UI
function mudarEstado(novo) {
    tcpState = novo; statusBadge.innerText = novo; statusBadge.className = `status-badge ${novo}`;
    if (novo === "ESTABLISHED") {
        wireLine.classList.add("connected"); remoteBadge.innerText = "ESTABLISHED"; remoteBadge.className="status-badge ESTABLISHED";
        msgInput.disabled=false; btnSend.disabled=false; btnFin.disabled=false; btnHandshake.disabled=true;
        msgInput.placeholder="Digite mensagem..."; if(msgAguardando) msgAguardando.style.display="none"; 
        btnOpenChaos.disabled = false; 
    } else if (novo === "CLOSED") {
        wireLine.classList.remove("connected");
        remoteBadge.innerText = "LISTENING"; remoteBadge.className="status-badge";
        btnHandshake.disabled=false; btnFin.disabled=true; 
        msgInput.disabled=true; btnSend.disabled=true; btnOpenChaos.disabled = true; 
        msgInput.placeholder="Conecte para digitar..."; if(msgAguardando) msgAguardando.style.display="block";
        if(isChaosMode) toggleChaosMode(false, true);
    } else {
        btnHandshake.disabled=true; btnFin.disabled=true; msgInput.disabled=true; btnSend.disabled=true; btnOpenChaos.disabled = true;
    }
}

// Botões de Ação do Usuário
function iniciarHandshake() { if (tcpState === "CLOSED") { mudarEstado("SYN_SENT"); enviarPacote("SYN"); } }
function iniciarFin() { if (tcpState === "ESTABLISHED") { mudarEstado("FIN_WAIT_1"); enviarPacote("FIN"); } }
function enviarMensagem() { if(msgInput.value){ adicionarNoChat(msgInput.value, "sent"); enviarPacote("DATA", msgInput.value); msgInput.value=""; msgInput.focus(); } }
function resetarLocalmente() { mudarEstado("CLOSED"); currentSeq=100; currentAck=0; atualizarInspetor({type:"-",tcp_seq:0,tcp_ack:0,payload:""}); logSistema("Conexão resetada."); }

// Helpers Visuais (Chat, Logs, Inspetor, Animação)
function atualizarInspetor(p) { inspSeq.innerText=p.tcp_seq||0; inspAck.innerText=p.tcp_ack||0; inspLen.innerText=p.payload?p.payload.length:0; inspFlags.innerText=(p.type==="DATA")?"PSH":p.type; inspSport.innerText = p.tcp_sport || 0; inspDport.innerText = p.tcp_dport || 0; inspPayload.innerText = p.payload || "[Vazio]";}
function logSistema(m) { miniLog.innerText=`> ${m}`; }
function adicionarNoChat(m,t) { chatWindow.innerHTML+=`<div class="chat-msg msg-${t}">${m}</div>`; chatWindow.scrollTop=chatWindow.scrollHeight; }
function animarRecebimento(p) { criarElementoPacote(p.type, "left"); setTimeout(()=>processarRecebimento(p), 1500); }
function criarElementoPacote(t,d) { const el=document.createElement("div"); el.className=`packet ${t} ${d==="right"?"anim-right":"anim-left"}`; el.innerText=t; packetLayer.appendChild(el); setTimeout(()=>el.remove(), 1600); }
function atualizarStatusTopo(t,c) { const e=document.getElementById("display-status"); e.innerText=t; e.style.color=c; }
function notificarConexaoEstabelecida() { atualizarStatusTopo("Parceiro Conectado", "#3fb950"); }
function mostrarModalDesconexao() { document.getElementById("modal-overlay").style.display="flex"; atualizarStatusTopo("Parceiro Saiu", "#ff7b72"); }
function voltarLobby() { location.reload(); }
function reiniciarSala() { document.getElementById("modal-overlay").style.display="none"; resetarLocalmente(); atualizarStatusTopo("Aguardando...", "#e3b341"); }

// LABORATÓRIO DE CAOS

// Solicita ativação/desativação do modo caos
function requestToggleChaos() { if (isChaosMode) toggleChaosMode(false, true); else toggleChaosMode(true, true); }

// Executa a troca de modo e sincroniza com o par
function toggleChaosMode(ativar, emitirAviso) {
    if (isChaosMode === ativar) return;
    isChaosMode = ativar;
    if (isChaosMode) openChaosLab(false); else closeChaosLab(false);
    if (emitirAviso && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "CHAOS_SYNC", action: isChaosMode ? "OPEN" : "CLOSE", original_sender_id: myId }));
}

// Inicializa variáveis e interface do laboratório
function openChaosLab(notify) {
    isChaosMode = true;
    simTime = 0;
    packets = [];
    spawnQueue = [];
    receivedLog = new Set(); 
    unackedData = {}; 
    receiverBuffer = {}; 
    nextExpectedSeq = 1000;
    isBursting = false;
    chaosPacketLayer.innerHTML = "";
    
    if (chaosLoopId) { cancelAnimationFrame(chaosLoopId); chaosLoopId = null; }

    if(chaosLogContainer) chaosLogContainer.innerHTML = "<div class='log-entry system'>--- Laboratório TCP Iniciado ---</div>";
    
    workspaceScreen.style.display = "none"; 
    chaosScreen.style.display = "block";    
    btnPauseToggle.disabled = false;
    aplicarPausa(false, null);
    startChaosEngine(); 
}

// Encerra o laboratório e limpa o loop
function closeChaosLab(notify) {
    isChaosMode = false;
    chaosScreen.style.display = "none";
    workspaceScreen.style.display = "block"; 
    cancelAnimationFrame(chaosLoopId);
    chaosLoopId = null;
}

// LABORATÓRIO DE CAOS - MOTOR E FÍSICA


// Loop principal de animação 
function startChaosEngine() {
    if (chaosLoopId) return; 
    function loop() {
        if (isChaosMode) {
            updatePhysics();
            chaosLoopId = requestAnimationFrame(loop);
        }
    }
    loop();
}

// Atualiza posições, gerencia spawn de rajadas e tempo
function updatePhysics() {
    if (isPaused) return; 

    simTime += 16; 

    // Geração de Pacotes
    if (spawnQueue.length > 0) {
        if (simTime >= spawnQueue[0].spawnAfter) {
            const next = spawnQueue.shift();
            if (!next.id) next.id = "pkt_" + Math.random().toString(36).substr(2, 9);
            if (spawnQueue.length > 0) spawnQueue[0].spawnAfter = simTime + 1000;
            
            createVisualPacket(next);
            
            notifyRemote("CHAOS_SPAWN", { 
                id: next.id,       
                seq: next.seq, 
                type: next.type, 
                isCorrupted: next.isCorrupted 
            });

            if (next.type === "DATA" && next.fromMe) {
                unackedData[next.seq] = { sentTime: simTime, attempts: 0, id: next.id };
            }
        }
    }

    // Movimento dos Pacotes
    for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        
        // Se estiver no buffer, ignora física de movimento
        if (p.isBuffered) continue;

        if (p.fromMe) {
            p.x += PACKET_SPEED;
            if (p.x >= 96) handleArrival(p, i); 
        } else {
            p.x -= PACKET_SPEED;
            if (p.x <= 4) handleArrival(p, i);  
        }

        if (p.el) p.el.style.left = p.x + "%";
    }

    // Atualização de Estado de UI (Botão)
    if (isBursting && spawnQueue.length === 0) {
        isBursting = false;
        updateFireButtonState();
    }

    checkRetransmissions();
    updateFireButtonState();
}

// Cria elementos visuais para pacotes do modo caos
function createVisualPacket(data) {
    const el = document.createElement("div");
    el.className = `packet ${data.type}`;
    if (data.ownerId !== myId) el.classList.add("peer"); 
    if (data.isCorrupted) el.classList.add("corrupted");
    
    el.innerText = data.type === "ACK" ? "ACK" : data.seq;
    el.style.transition = "none"; 
    
    chaosPacketLayer.appendChild(el);
    packets.push({ ...data, el: el });
}

// LABORATÓRIO DE CAOS - LÓGICA DO PROTOCOLO 

// Processa a chegada de pacotes: Validação, Buffer, Descarte e ACKs
function handleArrival(p, index) {
    if (packets.includes(p)) packets.splice(index, 1);
    
    // Se saiu de mim, apenas remove visualmente
    if (p.fromMe) { if(p.el) p.el.remove(); return; }

    // Trata ACK
    if (p.type === "ACK") {
        if(p.el) p.el.remove();
        if (unackedData[p.seq]) {
            logChaos(`TX: ACK ${p.seq} recebido.`, "ack");
            delete unackedData[p.seq]; 
            updateFireButtonState(); 
        }
        return;
    }

    // Trata Corrupção
    if (p.isCorrupted) {
        if(p.el) p.el.remove();
        logChaos(`RX: SEQ ${p.seq} CORROMPIDO! Descartando.`, "error");
        triggerNodeFlash(true, true); 
        return; 
    }

    // Trata Duplicidade
    if (receivedLog.has(p.seq)) {
        if(p.el) p.el.remove();
        logChaos(`RX: SEQ ${p.seq} Duplicado. Reenviando ACK.`, "warn");
        sendAck(p.seq); 
        return;
    }

    // BUFFER LÓGICA]
    
    // CASO A: Pacote Esperado
    if (p.seq === nextExpectedSeq) {
        processValidPacket(p);
        
        // Verifica o buffer (Loop)
        while (receiverBuffer[nextExpectedSeq]) {
            const bufferedPkt = receiverBuffer[nextExpectedSeq];
            delete receiverBuffer[nextExpectedSeq];
            
            logChaos(`BUFFER: Retirando SEQ ${bufferedPkt.seq}.`, "recv");
            processValidPacket(bufferedPkt);
        }
        
        syncBufferWithRemote();

    } 
    // CASO B: Pacote do Futuro (Bufferizar)
    else if (p.seq > nextExpectedSeq) {
        logChaos(`RX: SEQ ${p.seq} fora de ordem. Bufferizando.`, "warn");
        
        receiverBuffer[p.seq] = p;
        p.isBuffered = true; // Trava a física
        
        // Remove do fio imediatamente
        if (p.el) {
            p.el.remove();
            p.el = null; 
        }
        
        renderBufferLocal();
        syncBufferWithRemote();
        
        sendAck(p.seq); 
    } 
    // CASO C: Pacote Atrasado/Inútil
    else {
        if(p.el) p.el.remove();
        sendAck(p.seq);
    }
}

// Processa pacote válido e avança a janela
function processValidPacket(p) {
    if(p.el) p.el.remove(); 
    logChaos(`RX: SEQ ${p.seq} Processado.`, "recv");
    receivedLog.add(p.seq);
    triggerNodeFlash(true, false);
    sendAck(p.seq);
    nextExpectedSeq += 100; 
}

// Verifica timeouts e dispara retransmissões
function checkRetransmissions() {
    for (let seq in unackedData) {
        let entry = unackedData[seq];
        if (simTime - entry.sentTime > TIMEOUT_DURATION) {
            if (entry.attempts >= 3) {
                logChaos(`TX: Falha no SEQ ${seq}.`, "error");
                delete unackedData[seq];
                updateFireButtonState();
                continue;
            }
            logChaos(`TX: Timeout ${seq}. Retransmitindo...`, "warn");
            const retryPkt = {
                type: "DATA", seq: parseInt(seq), fromMe: true, ownerId: myId, x: 0, isCorrupted: false,
                id: "retry_" + Math.random().toString(36).substr(2, 9)
            };
            createVisualPacket(retryPkt);
            notifyRemote("CHAOS_SPAWN", retryPkt);
            entry.sentTime = simTime; entry.attempts++;
        }
    }
}

// Cria e envia ACK
function sendAck(seq) {
    const ackId = "ack_" + Math.random().toString(36).substr(2, 9);
    const pkt = { id: ackId, type: "ACK", seq: seq, fromMe: true, ownerId: myId, x: 0, isCorrupted: false };
    createVisualPacket(pkt);
    notifyRemote("CHAOS_SPAWN", pkt);
}

// Inicia rajada de pacotes
function dispararRajada() {
    if(isPaused || isBursting || Object.keys(unackedData).length > 0) return;
    isBursting = true;
    updateFireButtonState();
    logChaos(`TX: Rajada de ${burstCount} iniciada.`, "system");
    for (let i = 0; i < burstCount; i++) {
        spawnQueue.push({ type: "DATA", seq: myNextSeq, fromMe: true, ownerId: myId, x: 0, isCorrupted: false, spawnAfter: simTime });
        myNextSeq += 100;
    }
}

// LABORATÓRIO DE CAOS - BUFFER VISUAL

// Helper para ordenação
function sortSeqs(keys) {
    return keys.map(Number).sort((a, b) => a - b);
}

// Renderiza buffer local (Esquerda)
function renderBufferLocal() {
    const nodes = document.querySelectorAll(".node-icon");
    const myNode = nodes[0];
    const seqs = sortSeqs(Object.keys(receiverBuffer)); 
    
    const oldBuf = myNode.querySelector('.chaos-buffer-zone');
    if(oldBuf) oldBuf.remove();

    if(seqs.length > 0) {
        const buf = document.createElement("div");
        buf.className = "chaos-buffer-zone left visible";
        
        seqs.forEach(seq => {
            const pkt = document.createElement("div");
            pkt.className = "packet buffered";
            pkt.innerText = seq;
            buf.appendChild(pkt);
        });
        myNode.appendChild(buf);
    }
}

// Renderiza buffer remoto (Direita)
function renderBufferRemote(seqsRaw) {
    const nodes = document.querySelectorAll(".node-icon");
    const peerNode = nodes[1];
    const seqs = sortSeqs(seqsRaw || []);

    const oldBuf = peerNode.querySelector('.chaos-buffer-zone');
    if(oldBuf) oldBuf.remove();

    if(seqs.length > 0) {
        const buf = document.createElement("div");
        buf.className = "chaos-buffer-zone right visible";
        
        seqs.forEach(seq => {
            const pkt = document.createElement("div");
            pkt.className = "packet buffered peer"; 
            pkt.innerText = seq;
            buf.appendChild(pkt);
        });
        peerNode.appendChild(buf);
    }
}

// Sincroniza buffer com parceiro
function syncBufferWithRemote() {
    const seqs = sortSeqs(Object.keys(receiverBuffer));
    renderBufferLocal(); 
    notifyRemote("CHAOS_BUFFER_SYNC", { seqs: seqs });
}

// LABORATÓRIO DE CAOS - PAUSA E EDIÇÃO

// Solicita pausa
function requestPauseToggle() {
    if (isPaused && pausedBy !== myId) return;
    const novoEstado = !isPaused;
    if(ws && ws.readyState===1) ws.send(JSON.stringify({ type: "CHAOS_PAUSE", is_paused: novoEstado, paused_by: myId }));
    aplicarPausa(novoEstado, myId);
}

// Aplica estado de pausa na UI
function aplicarPausa(estado, quemPausou) {
    isPaused = estado;
    pausedBy = quemPausou;
    updateFireButtonState();
    chaosEditorArea.classList.remove("blocked");
    if (isPaused) {
        btnPauseToggle.innerHTML = (pausedBy === myId) ? "▶️ CONTINUAR" : "🔒 PARCEIRO EDITANDO";
        btnPauseToggle.style.backgroundColor = (pausedBy === myId) ? "#3fb950" : "#57606a";
        btnPauseToggle.disabled = (pausedBy !== myId);
        chaosEditorArea.classList.remove("hidden");
        if(pausedBy !== myId && pausedBy !== null) chaosEditorArea.classList.add("blocked");
        else renderEditor(); 
    } else {
        btnPauseToggle.innerHTML = "✋ PAUSAR TUDO";
        btnPauseToggle.style.backgroundColor = "#da3633";
        btnPauseToggle.disabled = false;
        chaosEditorArea.classList.add("hidden");
        startChaosEngine();
    }
}

// Renderiza lista de edição
function renderEditor() {
    activePacketList.innerHTML = "";
    const dataPackets = packets.filter(p => p.type === "DATA");
    if(dataPackets.length === 0) { activePacketList.innerHTML = '<div class="empty-msg">Nenhum pacote.</div>'; return; }
    dataPackets.forEach((p) => {
        const index = packets.indexOf(p);
        const card = document.createElement("div");
        const isMine = (p.ownerId === myId);
        card.className = isMine ? "packet-card" : "packet-card is-peer";
        let btns = "";
        if(isMine) {
            btns = `
            <button class="btn-icon" onclick="editPacket('swap', ${index}, -1)" title="Trás">⬆️</button>
            <button class="btn-icon" onclick="editPacket('swap', ${index}, 1)" title="Frente">⬇️</button>
            <button class="btn-icon btn-corrupt" onclick="editPacket('corrupt', ${index})" title="Corromper">⚡</button>
            <button class="btn-icon" onclick="editPacket('dup', ${index})" title="Duplicar">📑</button>
            <button class="btn-icon" onclick="editPacket('del', ${index})" title="Excluir">❌</button>`;
        } else { btns = "<span title='Somente o dono pode editar'>🔒</span>"; }
        card.innerHTML = `<div class="packet-info">SEQ ${p.seq}</div><div class="packet-actions">${btns}</div>`;
        activePacketList.appendChild(card);
    });
}

// Aplica edição local
function editPacket(action, idx, param) {
    if (!packets[idx] || packets[idx].ownerId !== myId) return;
    const p = packets[idx];
    if(!p.id) p.id = "pkt_" + Math.random().toString(36).substr(2, 9); 
    if (action === 'del') { p.el.remove(); packets.splice(idx, 1); }
    else if (action === 'corrupt') { p.isCorrupted = !p.isCorrupted; p.el.classList.toggle('corrupted'); }
    else if (action === 'dup') { createVisualPacket({...p, id: "pkt_" + Math.random().toString(36).substr(2, 9), el: null, x: p.x - 5}); }
    else if (action === 'swap') {
        const ti = idx + param;
        if(packets[ti] && packets[ti].type === "DATA") {
            const tempX = p.x; p.x = packets[ti].x; packets[ti].x = tempX;
            p.el.style.left = p.x + "%"; packets[ti].el.style.left = packets[ti].x + "%";
            packets[idx] = packets[ti]; packets[ti] = p;
        }
    }
    notifyRemote("CHAOS_EDIT", { action, id: p.id, idx1: idx, idx2: idx + param });
    renderEditor();
}

// Aplica edição remota
function aplicarEdicaoRemota(data) {
    let idx = packets.findIndex(p => p.id === data.id);
    if (idx === -1 && data.action !== 'swap') { if (packets[data.idx1]) idx = data.idx1; else return; }
    const p = packets[idx];
    if (data.action === 'corrupt') { p.isCorrupted = !p.isCorrupted; p.el.classList.toggle('corrupted'); }
    else if (data.action === 'del') { p.el.remove(); packets.splice(idx, 1); }
    else if (data.action === 'dup') { createVisualPacket({...p, id: "pkt_" + Math.random().toString(36).substr(2, 9), el: null, x: p.x - 5}); }
    else if (data.action === 'swap') {
        const idxA = data.idx1; const idxB = data.idx2;
        if(packets[idxA] && packets[idxB]) {
             const pktA = packets[idxA]; const pktB = packets[idxB];
             const tempX = pktA.x; pktA.x = pktB.x; pktB.x = tempX;
             pktA.el.style.left = pktA.x + "%"; pktB.el.style.left = pktB.x + "%";
             packets[idxA] = pktB; packets[idxB] = pktA;
        }
    }
    if(isPaused) renderEditor();
}

// UTILITÁRIOS DE INTERFACE E LOGS

// Flash visual no nó
function triggerNodeFlash(isReverse, isCorrupted) {
    const idx = isReverse ? 0 : 1; const node = chaosNodes[idx];
    if(node) {
        node.style.boxShadow = isCorrupted ? "0 0 20px red" : "0 0 20px #3fb950";
        setTimeout(() => node.style.boxShadow = "none", 200);
    }
}

// Atualiza estado do botão de disparo
function updateFireButtonState() {
    let btn = document.getElementById("btn-fire-burst");
    if(!btn) btn = document.getElementById("btn-fire");
    
    if(!btn) return;

    const pendingCount = Object.keys(unackedData).length;
    if (isPaused) { btn.disabled = true; btn.innerText = "PAUSADO"; btn.style.cursor = "not-allowed"; } 
    else if (pendingCount > 0) { btn.disabled = true; btn.innerText = `AGUARDANDO ACKs (${pendingCount})`; btn.style.cursor = "wait"; } 
    else if (isBursting) { btn.disabled = true; btn.innerText = "ENVIANDO..."; btn.style.cursor = "progress"; } 
    else { btn.disabled = false; btn.innerText = "DISPARAR"; btn.style.cursor = "pointer"; }
}

// Seleciona quantidade de pacotes
function mudarQtdRajada(n, btn) {
    burstCount = n;
    document.querySelectorAll(".btn-opt").forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
}

// Log do sistema
function logChaos(text, type="system") {
    const d = document.createElement("div");
    d.className = `log-entry ${type}`;
    const time = (typeof simTime !== 'undefined') ? Math.floor(simTime/1000) : 0;
    d.innerText = `[${time}s] ${text}`;

    const container = document.getElementById("chaos-log-container");
    if(container) {
        container.appendChild(d);
        container.scrollTop = container.scrollHeight;
    }
}

// INICIALIZAÇÃO

// Binding de eventos DOM
document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn-fire-burst") || document.getElementById("btn-fire");
    if(btn) {
        btn.onclick = (e) => { e.preventDefault(); dispararRajada(); };
    }
});
window.dispararRajada = dispararRajada;

// Inicia conexão WebSocket
conectarWS();