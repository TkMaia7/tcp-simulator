let ws;
const myId = "CLIENT_" + Math.floor(Math.random() * 1000);
let tcpState = "CLOSED";

const statusBadge = document.getElementById("status-client");
const remoteBadge = document.getElementById("status-server");
const wireLine = document.getElementById("wire-line");
const packetLayer = document.getElementById("packet-layer");
const miniLog = document.getElementById("mini-log");


function conectarWS() {
    ws = new WebSocket("ws://localhost:8000");

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.original_sender_id === myId) return;

        if (msg.type === "RESET") {
            alert("O outro cliente resetou a conexão.");
            location.reload();
            return;
        }

        animarRecebimento(msg.type);
    };
}

function processarRecebimento(tipo) {
    miniLog.innerText = `>> Processando pacote [${tipo}] | Estado Atual: ${tcpState}`;

    switch (tcpState) {
        case "CLOSED":
            if (tipo === "SYN") {
                mudarEstado("SYN_RCVD");
                setTimeout(() => enviarPacote("SYN-ACK"), 1600);
            }
            break;

        case "SYN_SENT":
            if (tipo === "SYN-ACK") {
                mudarEstado("ESTABLISHED");
                setTimeout(() => enviarPacote("ACK"), 1600);
            }
            break;

        case "SYN_RCVD":
            if (tipo === "ACK") {
                mudarEstado("ESTABLISHED");
            }
            break;
    }
}

function enviarPacote(tipo) {
    criarElementoPacote(tipo, "right");

    const pacote = { 
        type: tipo, 
        original_sender_id: myId,
        timestamp: Date.now()
    };
    ws.send(JSON.stringify(pacote));
}

function solicitarReset() {

    if (ws && ws.readyState === WebSocket.OPEN) {
        const pacote = { 
            type: "RESET", 
            original_sender_id: myId 
        };
        ws.send(JSON.stringify(pacote));
    }
    
    location.reload();
}

function animarRecebimento(tipo) {
    criarElementoPacote(tipo, "left");
    setTimeout(() => {
        processarRecebimento(tipo);
    }, 1500);
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

function mudarEstado(novoEstado) {
    tcpState = novoEstado;
    statusBadge.innerText = novoEstado;
    statusBadge.className = `status-badge ${novoEstado}`;

    if (novoEstado === "ESTABLISHED") {
        wireLine.classList.add("connected");
        remoteBadge.innerText = "CONNECTED";
        remoteBadge.classList.add("ESTABLISHED");
        miniLog.innerText = ">> CONEXÃO ESTABELECIDA COM SUCESSO (FULL DUPLEX).";
    }
}

function iniciarHandshake() {
    if (tcpState !== "CLOSED") return;
    
    mudarEstado("SYN_SENT");
    enviarPacote("SYN");
}

conectarWS();