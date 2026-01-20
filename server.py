import asyncio
import json
import websockets

# CONFIGURAÇÕES E GLOBAIS

# Armazenamento em memória das salas e clientes conectados
ROOMS = {}
ALL_CLIENTS = set()

# CICLO DE VIDA DA CONEXÃO

# Wrapper principal que gerencia a lista global de clientes conectados
async def handler_wrapper(websocket, path=None):
    ALL_CLIENTS.add(websocket)
    try:
        # Passa o path adiante se ele existir
        if path:
            await handler(websocket, path)
        else:
            await handler(websocket)
    finally:
        ALL_CLIENTS.remove(websocket)

# Manipulador principal de mensagens WebSocket por cliente
async def handler(websocket, path=None):
    print(f"[NOVA CONEXÃO] {websocket.remote_address}")
    websocket.current_room_id = None 
    
    # Envia a lista de salas assim que conecta
    await send_room_list(websocket)

    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "CREATE_ROOM":
                await handle_create_room(websocket, data)
            elif msg_type == "JOIN_ROOM":
                await handle_join_room(websocket, data)
            else:
                await handle_simulation_message(websocket, data)
            
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[ERRO GERAL] {e}")
    finally:
        await handle_disconnect(websocket)

# Gerencia a desconexão, limpeza de salas vazias e notificação de parceiros
async def handle_disconnect(ws):
    room_id = getattr(ws, 'current_room_id', None)
    if room_id and room_id in ROOMS:
        room = ROOMS[room_id]
        if ws in room["clients"]: room["clients"].remove(ws)
        
        for client in room["clients"]:
             await client.send(json.dumps({"type": "PEER_LEFT"}))

        if len(room["clients"]) == 0:
            del ROOMS[room_id]
            print(f"[SALA DELETADA] {room_id}")
            await broadcast_lobby_update() 

# GERENCIAMENTO DE SALAS E LOBBY

# Envia a lista atual de salas para um cliente específico
async def send_room_list(ws):
    lista_salas = list(ROOMS.keys())
    msg = json.dumps({"type": "ROOM_LIST", "rooms": lista_salas})
    await ws.send(msg)

# Notifica todos os usuários no lobby sobre mudanças nas salas
async def broadcast_lobby_update():
    lista_salas = list(ROOMS.keys())
    msg = json.dumps({"type": "ROOM_LIST", "rooms": lista_salas})
    
    tasks = []
    for client in ALL_CLIENTS:
        # Só manda pra quem está no lobby (current_room_id é None)
        if hasattr(client, 'current_room_id') and client.current_room_id is None:
            tasks.append(client.send(msg))
    
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

# Lógica para criação de nova sala
async def handle_create_room(ws, data):
    room_id = data.get("room_id")
    password = data.get("password")

    if room_id in ROOMS:
        await send_error(ws, "Nome de sala já existe.")
        return

    ROOMS[room_id] = { "password": password, "clients": {ws} }
    ws.current_room_id = room_id
    print(f"[SALA CRIADA] {room_id}")
    
    await ws.send(json.dumps({"type": "ROOM_ACCEPTED", "room_id": room_id, "role": "HOST"}))
    await broadcast_lobby_update() 

# Lógica para entrada em sala existente
async def handle_join_room(ws, data):
    room_id = data.get("room_id")
    password = data.get("password")

    if room_id not in ROOMS:
        await send_error(ws, "Sala não encontrada.")
        return
    room = ROOMS[room_id]
    if room["password"] != password:
        await send_error(ws, "Senha incorreta.")
        return
    if len(room["clients"]) >= 2:
        await send_error(ws, "Sala cheia (Max 2).")
        return

    for client in room["clients"]:
        await client.send(json.dumps({"type": "PEER_JOINED"}))

    room["clients"].add(ws)
    ws.current_room_id = room_id
    print(f"[ENTROU] {ws.remote_address} na sala {room_id}")

    await ws.send(json.dumps({"type": "ROOM_ACCEPTED", "room_id": room_id, "role": "GUEST"}))

# RELAY DE SIMULAÇÃO (P2P)

# Repassa mensagens de simulação entre os pares da sala
async def handle_simulation_message(ws, data):
    room_id = ws.current_room_id
    if not room_id or room_id not in ROOMS: return 
    
    room = ROOMS[room_id]
    tasks = []
    for client in room["clients"]:
        if client != ws:
            tasks.append(client.send(json.dumps(data)))
    if tasks: await asyncio.gather(*tasks, return_exceptions=True)

# UTILITÁRIOS

# Envia mensagem de erro padronizada para o cliente
async def send_error(ws, msg):
    await ws.send(json.dumps({"type": "ERROR", "message": msg}))

# INICIALIZAÇÃO DO SERVIDOR

# Configuração e inicialização do loop de eventos do servidor
async def main():
    print("=== TCP SERVER COM LOBBY AO VIVO (8000) ===")
    async with websockets.serve(handler_wrapper, "0.0.0.0", 8000):
        await asyncio.get_running_loop().create_future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServidor parado.")