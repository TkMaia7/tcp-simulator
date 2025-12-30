let ws;
const myId = "CLIENT_" + Math.floor(Math.random() * 10000);
let tcpState = "CLOSED";

// Controle TCP
let currentSeq = Math.floor(Math.random() * 1000) + 100; 
let currentAck = 0; 
const DEFAULT_HLEN = 5;
const MY_PORT = 50124;
const SERVER_PORT = 80;

// Elementos DOM
const statusBadge = document.getElementById("status-client");
const remoteBadge = document.getElementById("status-server");
const wireLine = document.getElementById("wire-line");
const packetLayer = document.getElementById("packet-layer");
const miniLog = document.getElementById("mini-log");
const msgInput = document.getElementById("msg-input");
const btnSend = document.getElementById("btn-send-data");
const chatWindow = document.getElementById("chat-window");
const msgAguardando = document.getElementById("msg-aguardando");
const inspSport = document.getElementById("insp-sport");
const inspDport = document.getElementById("insp-dport");
const inspSeq = document.getElementById("insp-seq");
const inspAck = document.getElementById("insp-ack");
const inspLen = document.getElementById("insp-len");
const inspFlags = document.getElementById("insp-flags");
const inspPayload = document.getElementById("insp-payload");

function conectarWS() {
    ws = new WebSocket("ws://localhost:8000");
    ws.onopen = () => logSistema("Conexão física estabelecida. Aguardando Handshake.");
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.original_sender_id === myId) return;
            if (msg.type === "RESET") { location.reload(); return; }
            animarRecebimento(msg);
        } catch (e) { console.error(e); }
    };
    ws.onerror = () => logSistema("ERRO: Servidor offline.", true);
}

function processarRecebimento(pacote) {
    const tipo = pacote.type;
    atualizarInspetor(pacote, "entrada");
    logSistema(`RX: [${tipo}] SEQ=${pacote.tcp_seq} | Estado: ${tcpState}`);

    if (pacote.tcp_seq !== undefined) {
        let incremento = 0;
        if (tipo === "SYN" || tipo === "SYN-ACK") incremento = 1;
        else if (tipo === "DATA" && pacote.payload) incremento = pacote.payload.length;
        currentAck = pacote.tcp_seq + incremento;
    }

    switch (tcpState) {
        case "CLOSED":
            if (tipo === "SYN") {
                mudarEstado("SYN_RCVD");
                setTimeout(() => enviarPacote("SYN-ACK"), 1000);
            }
            break;
        case "SYN_SENT":
            if (tipo === "SYN-ACK") {
                currentSeq++; 
                mudarEstado("ESTABLISHED");
                setTimeout(() => enviarPacote("ACK"), 1000);
            }
            break;
        case "SYN_RCVD":
            if (tipo === "ACK") mudarEstado("ESTABLISHED");
            break;
        case "ESTABLISHED":
            if (tipo === "DATA") {
                adicionarNoChat(pacote.payload, "received");
                logSistema(`Dados recebidos: ${pacote.payload.length} bytes.`);
            }
            break;
    }
}

function enviarPacote(tipo, payload = "") {
    let seqEnvio = currentSeq;
    let ackEnvio = currentAck;

    if (tipo === "SYN") ackEnvio = 0;
    if (tipo === "DATA") currentSeq += payload.length; 

    const pacote = { 
        type: tipo, 
        original_sender_id: myId,
        payload: payload,
        tcp_sport: MY_PORT,
        tcp_dport: SERVER_PORT,
        tcp_seq: seqEnvio,
        tcp_ack: ackEnvio,
        tcp_hlen: DEFAULT_HLEN,
        tcp_win: 65535
    };

    atualizarInspetor(pacote, "saida");
    criarElementoPacote(tipo, "right");
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pacote));
}

function atualizarInspetor(pacote, direcao) {
    const sport = pacote.tcp_sport || 0;
    const dport = pacote.tcp_dport || 0;
    const seq = (pacote.tcp_seq !== undefined) ? pacote.tcp_seq : 0;
    const ack = (pacote.tcp_ack !== undefined) ? pacote.tcp_ack : 0;

    let len = pacote.payload ? pacote.payload.length : 0;

    let flagsReais = "";
    switch (pacote.type) {
        case "SYN": flagsReais = "SYN"; break;
        case "SYN-ACK": flagsReais = "SYN, ACK"; break;
        case "ACK": flagsReais = "ACK"; break;
        case "DATA": flagsReais = "PSH, ACK"; break;
        case "RESET": flagsReais = "RST"; break;
        default: flagsReais = pacote.type;
    }

    inspSport.innerText = sport;
    inspDport.innerText = dport;
    atualizarComFlash(inspSeq, seq);
    atualizarComFlash(inspAck, ack);
    inspLen.innerText = len;
    inspFlags.innerText = flagsReais; 

    if (pacote.payload) {
        inspPayload.innerText = `"${pacote.payload}"`;
        inspPayload.style.color = "#58a6ff";
    } else {
        inspPayload.innerText = "[Header Only]";
        inspPayload.style.color = "#8b949e";
    }

    const box = document.querySelector('.inspector-box');
    box.style.borderColor = "#e3b341";
    setTimeout(() => box.style.borderColor = "#30363d", 300);
}

function atualizarComFlash(el, novoValor) {
    if (el.innerText != novoValor) {
        el.innerText = novoValor;
        el.classList.remove("flash-text");
        void el.offsetWidth;
        el.classList.add("flash-text");
    } else {
        el.innerText = novoValor;
    }
}

function mudarEstado(novoEstado) {
    tcpState = novoEstado;
    statusBadge.innerText = novoEstado;
    statusBadge.className = `status-badge ${novoEstado}`;

    if (novoEstado === "ESTABLISHED") {
        wireLine.classList.add("connected");
        remoteBadge.innerText = "ESTABLISHED";
        remoteBadge.classList.add("ESTABLISHED");
        if(msgAguardando) msgAguardando.style.display = "none";
        msgInput.disabled = false;
        btnSend.disabled = false;
        msgInput.placeholder = "Digite mensagem...";
        logSistema("ESTADO: ESTABLISHED (Full Duplex Ready).");
    }
}

function iniciarHandshake() {
    if (tcpState !== "CLOSED") return;
    mudarEstado("SYN_SENT");
    enviarPacote("SYN");
}

function enviarMensagem() {
    const texto = msgInput.value;
    if (!texto) return;
    adicionarNoChat(texto, "sent");
    enviarPacote("DATA", texto); 
    msgInput.value = "";
    msgInput.focus();
}

function solicitarReset() {
    if (ws) ws.send(JSON.stringify({ type: "RESET", original_sender_id: myId }));
    location.reload();
}

function adicionarNoChat(msg, tipo) {
    const balao = document.createElement("div");
    balao.className = `chat-msg msg-${tipo}`;
    balao.innerText = msg;
    chatWindow.appendChild(balao);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function logSistema(msg, erro = false) {
    miniLog.innerText = `> ${msg}`;
    miniLog.style.color = erro ? "#ff7b72" : "#3fb950";
}

function animarRecebimento(pacote) {
    criarElementoPacote(pacote.type, "left");
    setTimeout(() => processarRecebimento(pacote), 1500);
}

function criarElementoPacote(tipo, direcao) {
    const el = document.createElement("div");
    el.className = `packet ${tipo}`;
    el.innerText = tipo;
    if (direcao === "right") el.classList.add("anim-right");
    else el.classList.add("anim-left");
    packetLayer.appendChild(el);
    setTimeout(() => el.remove(), 1600);
}

if(msgInput) {
    msgInput.addEventListener("keypress", (e) => {
        if(e.key === "Enter") { e.preventDefault(); enviarMensagem(); }
    });
}

conectarWS();