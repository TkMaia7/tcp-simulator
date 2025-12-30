let ws;
// Gera ID aleatório para garantir que sou único
const myId = "CLIENT_" + Math.floor(Math.random() * 100000);
let tcpState = "CLOSED"; 

const logArea = document.getElementById("log-area");
const statusDiv = document.getElementById("connection-status");
const btnConnect = document.getElementById("btn-connect");

// --- 1. CONEXÃO FÍSICA ---
function conectarFisico() {
    console.log(`[INIT] Iniciando cliente com ID: ${myId}`);
    ws = new WebSocket("ws://localhost:8000");

    ws.onopen = () => {
        statusDiv.innerText = "ONLINE (AGUARDANDO)";
        log(`Sistema online. Meu ID: ${myId}`, "system");
        console.log("[WS] Conectado na porta 8000");
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            // FILTRO DE ID: Se o ID vier null ou for o meu, ignoro
            if (msg.original_sender_id === myId) {
                console.log("[IGNORADO] Mensagem minha retornou (Eco).");
                return;
            }

            console.log(`[RECEBIDO] De: ${msg.original_sender_id} | Tipo: ${msg.type}`);
            processarPacoteTCP(msg);

        } catch (e) {
            console.error("[ERRO NO RECEBIMENTO]", e);
        }
    };
    
    ws.onerror = (e) => console.error("[ERRO WS]", e);
}

// --- 2. MÁQUINA DE ESTADOS TCP ---
function processarPacoteTCP(pacote) {
    const tipo = pacote.type;
    
    // Log visual para sabermos o que chegou
    log(`Chegou pacote [${tipo}] enquanto estava em ${tcpState}`, "received");

    switch (tcpState) {
        case "CLOSED":
            if (tipo === "SYN") {
                log("Recebi pedido de conexão (SYN)!", "system");
                
                // MUDANÇA DE ESTADO
                tcpState = "SYN_RCVD";
                atualizarVisual("SYN_RCVD", "yellow");
                
                // RESPOSTA AUTOMÁTICA
                log("Respondendo com SYN-ACK...", "system");
                setTimeout(() => {
                    enviarPacote("SYN-ACK", 0, "Aceito conectar");
                }, 500); // Pequeno delay dramático
            } else {
                console.warn(`[DROP] Pacote ${tipo} ignorado no estado CLOSED.`);
            }
            break;

        case "SYN_SENT":
            if (tipo === "SYN-ACK") {
                log("Servidor aceitou! (SYN-ACK recebido)", "system");
                
                // MUDANÇA DE ESTADO
                tcpState = "ESTABLISHED";
                atualizarVisual("ESTABLISHED", "green");
                
                // CONFIRMAÇÃO FINAL
                log("Enviando ACK final...", "system");
                setTimeout(() => {
                    enviarPacote("ACK", 1, "Conexão Estabelecida!");
                }, 500);
            }
            break;

        case "SYN_RCVD":
            if (tipo === "ACK") {
                log("Handshake completo! (ACK recebido)", "system");
                tcpState = "ESTABLISHED";
                atualizarVisual("ESTABLISHED", "green");
            }
            break;
            
        case "ESTABLISHED":
            if (tipo === "DATA") {
                log(`MENSAGEM: ${pacote.payload}`, "received");
            }
            break;
    }
}

// --- 3. AÇÕES DO USUÁRIO ---
function iniciarHandshake() {
    if (tcpState !== "CLOSED") {
        alert(`Erro: Você já está no estado ${tcpState}. Dê F5 para reiniciar.`);
        return;
    }

    log("Iniciando conexão (Enviando SYN)...", "sent");
    tcpState = "SYN_SENT";
    atualizarVisual("SYN_SENT", "orange");
    
    enviarPacote("SYN", 0, "");
}

function enviarPacote(tipo, seq, payload) {
    if (ws.readyState !== WebSocket.OPEN) {
        console.error("Tentou enviar sem WebSocket conectado!");
        return;
    }

    const pacote = {
        type: tipo,
        seq: seq,
        payload: payload,
        original_sender_id: myId // ENVIA O ID CORRETAMENTE
    };
    
    ws.send(JSON.stringify(pacote));
    console.log(`[ENVIADO] ${tipo}`);
}

// --- 4. VISUAL ---
function atualizarVisual(estado, cor) {
    statusDiv.innerText = estado;
    // Remove classes antigas e adiciona novas
    statusDiv.className = "status"; 
    statusDiv.classList.add(cor); // ex: status + green
    
    if (estado === "ESTABLISHED") {
        const btnSend = document.getElementById("btn-send");
        if(btnSend) btnSend.disabled = false;
        if(btnConnect) btnConnect.disabled = true;
    }
}

function log(msg, tipo) {
    if(!logArea) return;
    const div = document.createElement("div");
    div.className = `log-entry ${tipo}`; // ex: log-entry sent
    div.innerText = `> ${msg}`;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

// Inicia
conectarFisico();