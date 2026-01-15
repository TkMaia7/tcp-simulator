import asyncio
import json
import websockets

ROOMS = {}

async def handler(websocket):
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

async def send_room_list(ws):
    # Cria uma lista apenas com os nomes das salas
    lista_salas = list(ROOMS.keys())
    msg = json.dumps({"type": "ROOM_LIST", "rooms": lista_salas})
    await ws.send(msg)

async def broadcast_room_list():
    lista_salas = list(ROOMS.keys())
    msg = json.dumps({"type": "ROOM_LIST", "rooms": lista_salas})
    
    pass 
ALL_CLIENTS = set()

async def handler_wrapper(websocket):
    ALL_CLIENTS.add(websocket)
    try:
        await handler(websocket)
    finally:
        ALL_CLIENTS.remove(websocket)

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
    await broadcast_lobby_update() # Atualiza o lobby dos outros

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

async def handle_simulation_message(ws, data):
    room_id = ws.current_room_id
    if not room_id or room_id not in ROOMS: return 
    
    room = ROOMS[room_id]
    tasks = []
    for client in room["clients"]:
        if client != ws:
            tasks.append(client.send(json.dumps(data)))
    if tasks: await asyncio.gather(*tasks, return_exceptions=True)

async def handle_disconnect(ws):
    room_id = ws.current_room_id
    if room_id and room_id in ROOMS:
        room = ROOMS[room_id]
        if ws in room["clients"]: room["clients"].remove(ws)
        
        for client in room["clients"]:
             await client.send(json.dumps({"type": "PEER_LEFT"}))

        if len(room["clients"]) == 0:
            del ROOMS[room_id]
            print(f"[SALA DELETADA] {room_id}")
            await broadcast_lobby_update() 

async def send_error(ws, msg):
    await ws.send(json.dumps({"type": "ERROR", "message": msg}))

async def main():
    print("=== TCP SERVER COM LOBBY AO VIVO (8000) ===")
    async with websockets.serve(handler_wrapper, "0.0.0.0", 8000):
        await asyncio.get_running_loop().create_future()

if __name__ == "__main__":
    asyncio.run(main())