let ws;
const myId = "CLIENT_" + Math.floor(Math.random() * 10000);
let tcpState = "CLOSED";
let currentRoom = null;

// Controle TCP
let currentSeq = Math.floor(Math.random() * 1000) + 100; 
let currentAck = 0; 

// Elementos DOM (Lobby)
const lobbyScreen = document.getElementById("lobby-screen");
const workspaceScreen = document.getElementById("workspace-screen");
const roomNameInput = document.getElementById("room-name");
const roomPassInput = document.getElementById("room-pass");
const lobbyMsg = document.getElementById("lobby-msg");

// Elementos DOM (Simulador)
const packetLayer = document.getElementById("packet-layer");
const miniLog = document.getElementById("mini-log");
const msgInput = document.getElementById("msg-input");
const btnSend = document.getElementById("btn-send-data");
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


// --- 1. CONEXÃO INICIAL E ROTEAMENTO (CORRIGIDO PARA AWS) ---
function conectarWS() {
    const host = window.location.hostname;
    let url;

    // LÓGICA DE DETECÇÃO DE AMBIENTE
    if (window.location.protocol === 'https:') {
        // Se o site tem cadeado (HTTPS), usa WSS e a rota /ws do Nginx
        console.log("Ambiente Seguro (AWS) detectado.");
        url = `wss://${host}/ws`;
    } else {
        // Se é localhost ou HTTP normal, usa a porta 8000 direta
        console.log("Ambiente Local detectado.");
        // Se o host for vazio (abriu o arquivo direto), assume localhost
        const targetHost = host || "localhost";
        url = `ws://${targetHost}:8000`;
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
        console.log("Conectado ao WebSocket!");
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
                        document.getElementById("display-status").innerText = "Aguardando Jogador 2...";
                        document.getElementById("display-status").style.color = "#e3b341"; 
                    } else {
                        logSistema("Você entrou na sala. Conexão pronta.");
                        notificarConexaoEstabelecida();
                    }
                    break;
                case "ERROR":
                    mostrarErroLobby(msg.message);
                    break;
                case "RESET":
                    alert("Reset solicitado.");
                    location.reload();
                    break;
                case "PEER_JOINED":
                    logSistema("Um parceiro entrou na sala!");
                    notificarConexaoEstabelecida();
                    break;
                case "PEER_LEFT":
                    mostrarModalDesconexao();
                    break;
                default:
                    if (msg.original_sender_id !== myId) {
                        animarRecebimento(msg);
                    }
            }
        } catch (e) { console.error(e); }
    };

    ws.onerror = (error) => {
        console.error("Erro WebSocket:", error);
        mostrarErroLobby("Erro de Conexão (Verifique Console)");
    };
    
    ws.onclose = () => {
        console.log("WebSocket fechado.");
    };
}

// --- 2. FUNÇÕES DO LOBBY ---

function criarSala() {
    if(!ws || ws.readyState !== WebSocket.OPEN) {
        mostrarErroLobby("Sem conexão com o servidor.");
        return;
    }
    
    const nome = roomNameInput.value.trim();
    const senha = roomPassInput.value.trim();
    if (!nome || !senha) return mostrarErroLobby("Preencha nome e senha.");

    ws.send(JSON.stringify({
        type: "CREATE_ROOM",
        room_id: nome,
        password: senha
    }));
}

function entrarSala() {
    if(!ws || ws.readyState !== WebSocket.OPEN) {
        mostrarErroLobby("Sem conexão com o servidor.");
        return;
    }

    const nome = roomNameInput.value.trim();
    const senha = roomPassInput.value.trim();
    if (!nome || !senha) return mostrarErroLobby("Preencha nome e senha.");

    ws.send(JSON.stringify({
        type: "JOIN_ROOM",
        room_id: nome,
        password: senha
    }));
}

function mostrarErroLobby(msg) {
    lobbyMsg.innerText = msg;
    lobbyMsg.style.color = "#ff7b72";
}

function entrarNoSimulador(salaId) {
    currentRoom = salaId;
    lobbyScreen.style.display = "none";
    workspaceScreen.style.display = "block";
    document.getElementById("display-room-name").innerText = salaId;
    logSistema(`Entrou na sala: ${salaId}`);
}

// --- 3. LÓGICA TCP ---
function processarRecebimento(pacote) {
    pacote.tcp_seq = Number(pacote.tcp_seq);
    pacote.tcp_ack = Number(pacote.tcp_ack);
    
    atualizarInspetor(pacote, "entrada");
    logSistema(`RX [${pacote.type}] SEQ=${pacote.tcp_seq}`);

    let incremento = 0;
    if (pacote.type === "SYN" || pacote.type === "SYN-ACK") incremento = 1;
    else if (pacote.type === "DATA" && pacote.payload) incremento = pacote.payload.length;
    
    if (!isNaN(pacote.tcp_seq)) {
        currentAck = pacote.tcp_seq + incremento;
    }

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
            if (pacote.type === "DATA") {
                adicionarNoChat(pacote.payload, "received");
            }
            break;
    }
}

// --- 4. ENVIO E UI ---
function enviarPacote(tipo, payload = "") {
    let seqEnvio = currentSeq;
    let ackEnvio = currentAck;

    if (tipo === "SYN") ackEnvio = 0;
    if (tipo === "DATA") currentSeq += payload.length;

    const pacote = { 
        type: tipo, 
        original_sender_id: myId,
        payload: payload,
        tcp_seq: seqEnvio,
        tcp_ack: ackEnvio,
        tcp_sport: 50124, tcp_dport: 80, tcp_hlen: 5, tcp_win: 65535
    };

    atualizarInspetor(pacote, "saida");
    criarElementoPacote(tipo, "right");
    
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pacote));
}

// UI Helpers
function atualizarInspetor(pacote, direcao) {
    const sport = pacote.tcp_sport || 0;
    const dport = pacote.tcp_dport || 0;
    const seq = pacote.tcp_seq !== undefined ? pacote.tcp_seq : 0;
    const ack = pacote.tcp_ack !== undefined ? pacote.tcp_ack : 0;
    const len = pacote.payload ? pacote.payload.length : 0;
    
    let flags = pacote.type;
    if(pacote.type === "DATA") flags = "PSH, ACK";
    if(pacote.type === "SYN-ACK") flags = "SYN, ACK";

    inspSport.innerText = sport; inspDport.innerText = dport;
    atualizarComFlash(inspSeq, seq); atualizarComFlash(inspAck, ack);
    inspLen.innerText = len; inspFlags.innerText = flags;
    
    if(pacote.payload) { inspPayload.innerText = `"${pacote.payload}"`; inspPayload.style.color="#58a6ff"; }
    else { inspPayload.innerText = "[Header Only]"; inspPayload.style.color="#8b949e"; }
    
    const box = document.querySelector('.inspector-box');
    box.style.borderColor = "#e3b341";
    setTimeout(() => box.style.borderColor = "#30363d", 300);
}

function atualizarComFlash(el, val) {
    if(el.innerText != val) {
        el.innerText = val; el.classList.remove("flash-text");
        void el.offsetWidth; el.classList.add("flash-text");
    }
}

function mudarEstado(novo) {
    tcpState = novo;
    statusBadge.innerText = novo; statusBadge.className = `status-badge ${novo}`;
    if (novo === "ESTABLISHED") {
        wireLine.classList.add("connected");
        remoteBadge.innerText = "ESTABLISHED"; remoteBadge.classList.add("ESTABLISHED");
        if(msgAguardando) msgAguardando.style.display="none";
        msgInput.disabled=false; btnSend.disabled=false; msgInput.placeholder="Digite...";
        logSistema("Conexão Pronta.");
    }
}

function iniciarHandshake() { if (tcpState === "CLOSED") { mudarEstado("SYN_SENT"); enviarPacote("SYN"); } }
function solicitarReset() { if(ws) ws.send(JSON.stringify({type: "RESET"})); location.reload(); }
function enviarMensagem() { 
    if(!msgInput.value) return; 
    adicionarNoChat(msgInput.value, "sent"); 
    enviarPacote("DATA", msgInput.value); 
    msgInput.value=""; msgInput.focus(); 
}
function adicionarNoChat(msg, tipo) {
    const b = document.createElement("div"); b.className=`chat-msg msg-${tipo}`; b.innerText=msg;
    chatWindow.appendChild(b); chatWindow.scrollTop = chatWindow.scrollHeight;
}
function logSistema(msg) { miniLog.innerText = `> ${msg}`; }
function animarRecebimento(p) { criarElementoPacote(p.type, "left"); setTimeout(()=>processarRecebimento(p), 1500); }
function criarElementoPacote(t, d) {
    const el = document.createElement("div"); el.className=`packet ${t} ${d==="right"?"anim-right":"anim-left"}`; el.innerText=t;
    packetLayer.appendChild(el); setTimeout(()=>el.remove(), 1600);
}
if(msgInput) msgInput.addEventListener("keypress", e=>{if(e.key==="Enter"){e.preventDefault();enviarMensagem()}});

function notificarConexaoEstabelecida() {
    const statusEl = document.getElementById("display-status");
    statusEl.innerText = "Parceiro Conectado";
    statusEl.style.color = "#3fb950"; 

    miniLog.style.borderColor = "#3fb950";
    setTimeout(() => miniLog.style.borderColor = "#30363d", 1000);
}

function mostrarModalDesconexao() {
    modalOverlay.style.display = "flex"; 
    logSistema("O parceiro desconectou.", true);
    document.getElementById("display-status").innerText = "Parceiro Desconectado";
    document.getElementById("display-status").style.color = "#ff7b72";
}

function voltarLobby() {
    location.reload();
}

function reiniciarSala() {
    modalOverlay.style.display = "none";
    
    document.getElementById("chat-window").innerHTML = '<div class="system-msg" id="msg-aguardando">--- Canal Reiniciado ---</div>';
    logSistema("Sala reiniciada. Aguardando novo parceiro...");
    
    tcpState = "CLOSED";
    statusBadge.innerText = "CLOSED";
    statusBadge.className = "status-badge CLOSED";
    wireLine.classList.remove("connected");
    remoteBadge.innerText = "LISTENING"; 
    remoteBadge.classList.remove("ESTABLISHED");
    remoteBadge.className = "status-badge"; 
    
    msgInput.disabled = true;
    btnSend.disabled = true;
    
    const statusEl = document.getElementById("display-status");
    statusEl.innerText = "Aguardando Jogador 2...";
    statusEl.style.color = "#e3b341";
}

conectarWS();