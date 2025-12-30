let ws;
const logArea = document.getElementById("log-area");
const statusDiv = document.getElementById("connection-status");

function conectar() {
    // Conecta ao servidor Python na porta 8000
    ws = new WebSocket("ws://localhost:8000");

    ws.onopen = () => {
        statusDiv.innerText = "ONLINE (CONECTADO)";
        statusDiv.className = "status online";
        log("Conexão estabelecida com o servidor.", "system");
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        log(`RECEBIDO: ${JSON.stringify(data)}`, "received");
    };

    ws.onclose = () => {
        statusDiv.innerText = "OFFLINE";
        statusDiv.className = "status offline";
        log("Conexão perdida. Tente reconectar.", "system");
    };

    ws.onerror = (error) => {
        log("Erro na conexão WebSocket.", "system");
        console.error(error);
    };
}

function enviarPacoteTeste() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert("Você precisa conectar primeiro!");
        return;
    }

    const pacote = {
        type: "DATA",
        seq: 100,
        payload: "Olá, TCP!"
    };

    ws.send(JSON.stringify(pacote));
    log(`ENVIADO: ${JSON.stringify(pacote)}`, "sent");
}

// Função auxiliar para escrever no terminal visual
function log(mensagem, tipo) {
    const div = document.createElement("div");
    div.className = `log-entry ${tipo}`;
    div.innerText = `> ${mensagem}`;
    
    logArea.appendChild(div);
    // Auto-scroll para o final
    logArea.scrollTop = logArea.scrollHeight;
}

// Inicia conexão automaticamente ao carregar
conectar();