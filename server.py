import asyncio
import json
import websockets

ROOMS = {}

async def handler(websocket):
    print(f"[NOVA CONEXÃO] {websocket.remote_address}")
    # Atributo para rastrear em qual sala esse socket está
    websocket.current_room_id = None 
    
    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")
            
            # LOBBY
            if msg_type == "CREATE_ROOM":
                await handle_create_room(websocket, data)
                
            elif msg_type == "JOIN_ROOM":
                await handle_join_room(websocket, data)

            # SIMULAÇÃO
            else:
                await handle_simulation_message(websocket, data)
            
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[ERRO GERAL] {e}")
    finally:
        await handle_disconnect(websocket)

async def handle_create_room(ws, data):
    room_id = data.get("room_id")
    password = data.get("password")

    if room_id in ROOMS:
        await send_error(ws, "Nome de sala já existe.")
        return

    # Cria a sala
    ROOMS[room_id] = {
        "password": password,
        "clients": {ws}
    }
    ws.current_room_id = room_id
    print(f"[SALA CRIADA] {room_id} por {ws.remote_address}")
    
    await ws.send(json.dumps({"type": "ROOM_ACCEPTED", "room_id": room_id, "role": "HOST"}))

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

    # Adiciona o novo cliente
    room["clients"].add(ws)
    ws.current_room_id = room_id
    print(f"[ENTROU] {ws.remote_address} na sala {room_id}")

    await ws.send(json.dumps({"type": "ROOM_ACCEPTED", "room_id": room_id, "role": "GUEST"}))

async def handle_simulation_message(ws, data):
    room_id = ws.current_room_id
    
    # Só roteia se o usuário estiver em uma sala
    if not room_id or room_id not in ROOMS:
        return 
    
    # Encaminha apenas para os outros membros da sala
    room = ROOMS[room_id]
    msg_to_forward = data.copy()
    
    tasks = []
    for client in room["clients"]:
        if client != ws:
            tasks.append(client.send(json.dumps(msg_to_forward)))
    
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

async def handle_disconnect(ws):
    room_id = ws.current_room_id
    
    if room_id and room_id in ROOMS:
        room = ROOMS[room_id]
        if ws in room["clients"]:
            room["clients"].remove(ws)
        
        print(f"[SAIU] Cliente da sala {room_id}")

        # Avisa o sobrevivente que o parceiro saiu
        for client in room["clients"]:
             await client.send(json.dumps({"type": "PEER_LEFT"}))

        # Se a sala ficou vazia, deleta
        if len(room["clients"]) == 0:
            del ROOMS[room_id]
            print(f"[SALA DELETADA] {room_id} (Vazia)")

async def send_error(ws, msg):
    await ws.send(json.dumps({"type": "ERROR", "message": msg}))

async def main():
    print("=== TCP SERVER COM SALAS RODANDO (8000) ===")
    async with websockets.serve(handler, "0.0.0.0", 8000):
        await asyncio.get_running_loop().create_future()

if __name__ == "__main__":
    asyncio.run(main())