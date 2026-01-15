let ws;
const myId = "CLIENT_" + Math.floor(Math.random() * 10000);
let tcpState = "CLOSED";
let currentRoom = null;

// Controle TCP
let currentSeq = Math.floor(Math.random() * 1000) + 100; 
let currentAck = 0; 

// Elementos DOM
const lobbyScreen = document.getElementById("lobby-screen");
const workspaceScreen = document.getElementById("workspace-screen");
const roomNameInput = document.getElementById("room-name");
const roomPassInput = document.getElementById("room-pass");
const lobbyMsg = document.getElementById("lobby-msg");

// Elementos Simulador
const packetLayer = document.getElementById("packet-layer");
const miniLog = document.getElementById("mini-log");
const msgInput = document.getElementById("msg-input");
const btnSend = document.getElementById("btn-send-data");
const btnHandshake = document.getElementById("btn-handshake"); // Novo
const btnFin = document.getElementById("btn-fin"); // Novo
const chatWindow = document.getElementById("chat-window");
const statusBadge = document.getElementById("status-client");
const remoteBadge = document.getElementById("status-server");
const wireLine = document.getElementById("wire-line");
const msgAguardando = document.getElementById("msg-aguardando");
const modalOverlay = document.getElementById("modal-overlay");

// Inspetor
const inspSport = document.getElementById("insp-sport");
const inspDport = document.getElementById("insp-dport");
const inspSeq = document.getElementById("insp-seq");
const inspAck = document.getElementById("insp-ack");
const inspLen = document.getElementById("insp-len");
const inspFlags = document.getElementById("insp-flags");
const inspPayload = document.getElementById("insp-payload");


// --- 1. CONEXÃO ---
function conectarWS() {
    const host = window.location.hostname;
    let url;
    if (window.location.protocol === 'https:') {
        url = `wss://${host}/ws`;
    } else {
        const targetHost = host || "localhost";
        url = `ws://${targetHost}:8000`;
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
        lobbyMsg.innerText = "Conectado ao servidor. Pronto.";
        lobbyMsg.style.color = "#3fb950";
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
                case "ROOM_ACCEPTED":
                    entrarNoSimulador(msg.room_id);
                    if (msg.role === "HOST") {
                        logSistema("Sala criada. Aguardando parceiro...");
                        atualizarStatusTopo("Aguardando P2...", "#e3b341");
                    } else {
                        logSistema("Você entrou na sala.");
                        notificarConexaoEstabelecida();
                    }
                    break;
                case "ERROR": mostrarErroLobby(msg.message); break;
                case "PEER_JOINED": logSistema("Parceiro entrou!"); notificarConexaoEstabelecida(); break;
                case "PEER_LEFT": mostrarModalDesconexao(); break;
                default: if (msg.original_sender_id !== myId) animarRecebimento(msg);
            }
        } catch (e) { console.error(e); }
    };
    ws.onerror = () => mostrarErroLobby("Erro de Conexão.");
}

// --- 2. LOBBY ---
function criarSala() { if(validarWS()) ws.send(JSON.stringify({type: "CREATE_ROOM", room_id: roomNameInput.value, password: roomPassInput.value})); }
function entrarSala() { if(validarWS()) ws.send(JSON.stringify({type: "JOIN_ROOM", room_id: roomNameInput.value, password: roomPassInput.value})); }
function validarWS() { if(!ws || ws.readyState!==1) { mostrarErroLobby("Sem conexão."); return false;} return true; }
function mostrarErroLobby(m) { lobbyMsg.innerText=m; lobbyMsg.style.color="#ff7b72"; }

function entrarNoSimulador(id) {
    currentRoom = id;
    lobbyScreen.style.display="none";
    workspaceScreen.style.display="block";
    document.getElementById("display-room-name").innerText = id;
}

// --- 3. LÓGICA TCP (Com FIN-ACK) ---
function processarRecebimento(pacote) {
    pacote.tcp_seq = Number(pacote.tcp_seq);
    pacote.tcp_ack = Number(pacote.tcp_ack);
    atualizarInspetor(pacote);
    logSistema(`RX [${pacote.type}] SEQ=${pacote.tcp_seq}`);

    let len = (pacote.payload) ? pacote.payload.length : 0;
    if (pacote.type === "SYN" || pacote.type === "FIN" || pacote.type === "SYN-ACK") len = 1;
    
    if (!isNaN(pacote.tcp_seq)) currentAck = pacote.tcp_seq + len;

    // MÁQUINA DE ESTADOS
    switch (tcpState) {
        case "CLOSED":
            if (pacote.type === "SYN") {
                mudarEstado("SYN_RCVD");
                setTimeout(() => enviarPacote("SYN-ACK"), 1000);
            }
            break;

        case "SYN_SENT":
            if (pacote.type === "SYN-ACK") {
                currentSeq++;
                mudarEstado("ESTABLISHED");
                setTimeout(() => enviarPacote("ACK"), 1000);
            }
            break;

        case "SYN_RCVD":
            if (pacote.type === "ACK") mudarEstado("ESTABLISHED");
            break;

        case "ESTABLISHED":
            if (pacote.type === "DATA") adicionarNoChat(pacote.payload, "received");
            if (pacote.type === "FIN") {
                // O outro quer sair. Iniciamos o fechamento passivo.
                mudarEstado("CLOSE_WAIT");
                // 1. Envia ACK do FIN recebido
                setTimeout(() => {
                    enviarPacote("ACK");
                    // 2. Envia nosso próprio FIN logo depois (simulando app fechando)
                    setTimeout(() => {
                        mudarEstado("LAST_ACK");
                        enviarPacote("FIN");
                    }, 1500);
                }, 500);
            }
            break;

        // --- ESTADOS DE ENCERRAMENTO (Quem pediu pra sair) ---
        case "FIN_WAIT_1":
            if (pacote.type === "ACK") mudarEstado("FIN_WAIT_2");
            if (pacote.type === "FIN") {
                // Cruzamento de FINs ou sequência rápida
                enviarPacote("ACK");
                mudarEstado("TIME_WAIT");
                setTimeout(resetarLocalmente, 2000); // Fecha após 2s
            }
            break;

        case "FIN_WAIT_2":
            if (pacote.type === "FIN") {
                enviarPacote("ACK");
                mudarEstado("TIME_WAIT");
                setTimeout(resetarLocalmente, 2000);
            }
            break;

        // --- ESTADOS DE ENCERRAMENTO (Quem recebeu o pedido) ---
        case "LAST_ACK":
            if (pacote.type === "ACK") {
                resetarLocalmente(); // Fim do ciclo
            }
            break;
    }
}

function enviarPacote(tipo, payload = "") {
    let seq = currentSeq;
    let ack = currentAck;

    if (tipo === "SYN" || tipo === "FIN") ack = 0; // Simplificação
    if (tipo === "DATA") currentSeq += payload.length;
    if (tipo === "SYN" || tipo === "FIN") currentSeq++; // Consome 1 seq

    const pacote = { 
        type: tipo, original_sender_id: myId, payload: payload,
        tcp_seq: seq, tcp_ack: ack, tcp_sport: 50124, tcp_dport: 80
    };

    atualizarInspetor(pacote);
    criarElementoPacote(tipo, "right");
    if(ws && ws.readyState===1) ws.send(JSON.stringify(pacote));
}

function mudarEstado(novo) {
    tcpState = novo;
    statusBadge.innerText = novo; 
    statusBadge.className = `status-badge ${novo}`;
    
    // Controle dos Botões
    if (novo === "ESTABLISHED") {
        wireLine.classList.add("connected");
        remoteBadge.innerText = "ESTABLISHED"; remoteBadge.className="status-badge ESTABLISHED";
        msgInput.disabled=false; btnSend.disabled=false; btnFin.disabled=false; btnHandshake.disabled=true;
        msgInput.placeholder="Digite mensagem...";
        msgAguardando.style.display="none";
    } else if (novo === "CLOSED") {
        // Estado inicial
        btnHandshake.disabled=false; btnFin.disabled=true;
    } else {
        // Estados de transição (Handshake ou Teardown)
        btnHandshake.disabled=true; btnFin.disabled=true; msgInput.disabled=true; btnSend.disabled=true;
    }
}

// --- AÇÕES DO USUÁRIO ---
function iniciarHandshake() { if (tcpState === "CLOSED") { mudarEstado("SYN_SENT"); enviarPacote("SYN"); } }
function iniciarFin() { if (tcpState === "ESTABLISHED") { mudarEstado("FIN_WAIT_1"); enviarPacote("FIN"); } }
function enviarMensagem() { if(msgInput.value){ adicionarNoChat(msgInput.value, "sent"); enviarPacote("DATA", msgInput.value); msgInput.value=""; msgInput.focus(); } }

// --- AUXILIARES ---
function resetarLocalmente() {
    mudarEstado("CLOSED");
    wireLine.classList.remove("connected");
    remoteBadge.innerText = "LISTENING"; remoteBadge.className="status-badge";
    currentSeq = Math.floor(Math.random()*1000)+100; 
    currentAck = 0;
    logSistema("Conexão encerrada. Pronto para novo Handshake.");
    chatWindow.innerHTML += '<div class="system-msg">--- Conexão Encerrada ---</div>';
    atualizarInspetor({type: "-", tcp_seq:0, tcp_ack:0, payload:""});
}

function atualizarInspetor(p) {
    inspSport.innerText=p.tcp_sport||0; inspDport.innerText=p.tcp_dport||0;
    atualizarComFlash(inspSeq, p.tcp_seq||0); atualizarComFlash(inspAck, p.tcp_ack||0);
    inspLen.innerText=p.payload?p.payload.length:0; 
    inspFlags.innerText= (p.type==="DATA")?"PSH, ACK":p.type;
    inspPayload.innerText=p.payload?`"${p.payload}"`:"[Header]";
    document.querySelector('.inspector-box').style.borderColor="#e3b341";
    setTimeout(()=>document.querySelector('.inspector-box').style.borderColor="#30363d",300);
}
function atualizarComFlash(el, v) { if(el.innerText!=v) { el.innerText=v; el.classList.remove("flash-text"); void el.offsetWidth; el.classList.add("flash-text"); } }
function adicionarNoChat(m,t) { chatWindow.innerHTML+=`<div class="chat-msg msg-${t}">${m}</div>`; chatWindow.scrollTop=chatWindow.scrollHeight; }
function logSistema(m) { miniLog.innerText=`> ${m}`; }
function animarRecebimento(p) { criarElementoPacote(p.type, "left"); setTimeout(()=>processarRecebimento(p), 1500); }
function criarElementoPacote(t,d) { 
    const el=document.createElement("div"); el.className=`packet ${t} ${d==="right"?"anim-right":"anim-left"}`; el.innerText=t; 
    packetLayer.appendChild(el); setTimeout(()=>el.remove(), 1600); 
}
function atualizarStatusTopo(t,c) { const e=document.getElementById("display-status"); e.innerText=t; e.style.color=c; }
function notificarConexaoEstabelecida() { atualizarStatusTopo("Parceiro Conectado", "#3fb950"); miniLog.style.borderColor="#3fb950"; setTimeout(()=>miniLog.style.borderColor="#30363d",1000); }
function mostrarModalDesconexao() { modalOverlay.style.display="flex"; atualizarStatusTopo("Parceiro Saiu", "#ff7b72"); }
function voltarLobby() { location.reload(); }
function reiniciarSala() { modalOverlay.style.display="none"; resetarLocalmente(); atualizarStatusTopo("Aguardando...", "#e3b341"); }

// Auto-start
conectarWS();