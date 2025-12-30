import asyncio
import json
import websockets

CONNECTED_CLIENTS = set()

async def handler(websocket):
    print(f"[NOVA CONEXÃO] {websocket.remote_address}")
    CONNECTED_CLIENTS.add(websocket)
    
    try:
        async for message in websocket:
            data = json.loads(message)

            msg_to_forward = data.copy()
            
            print(f"[ENCAMINHANDO] Tipo: {data.get('type')} | SEQ: {data.get('tcp_seq')}")

            tasks = []
            for client in CONNECTED_CLIENTS:
                if client != websocket:
                    tasks.append(client.send(json.dumps(msg_to_forward)))
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            
    except Exception:
        pass
    finally:
        CONNECTED_CLIENTS.remove(websocket)
        print(f"[DESCONECTADO] {websocket.remote_address}")

async def main():
    print("=== TCP SERVER RODANDO (0.0.0.0:8000) ===")
    async with websockets.serve(handler, "0.0.0.0", 8000):
        await asyncio.get_running_loop().create_future()

if __name__ == "__main__":
    asyncio.run(main())