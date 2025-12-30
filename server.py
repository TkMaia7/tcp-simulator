import asyncio
import json
import websockets

CONNECTED_CLIENTS = set()

async def handler(websocket):
    print(f"[NOVA CONEXÃO] Cliente: {websocket.remote_address}")
    CONNECTED_CLIENTS.add(websocket)
    
    try:
        async for message in websocket:
            
            data = json.loads(message)
            
            print(f"[SERVIDOR] Recebido: {data}")
            
            msg_to_forward = {
                "type": data.get("type"), 
                "payload": data.get("payload"),
                "seq": data.get("seq"),
                "original_sender_id": data.get("original_sender_id")
            }
            
            tasks = []
            for client in CONNECTED_CLIENTS:
                if client != websocket:
                    print(f"Repassando para cliente remoto...")
                    tasks.append(client.send(json.dumps(msg_to_forward)))
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            
    except websockets.exceptions.ConnectionClosed:
        print(f"[DESCONECTADO] {websocket.remote_address}")
    except Exception as e:
        print(f"[ERRO] {e}")
    finally:
        CONNECTED_CLIENTS.remove(websocket)

async def main():
    print("=== TCP SIMULATOR SERVER RODANDO (Porta 8000) ===")
    async with websockets.serve(handler, "localhost", 8000):
        await asyncio.get_running_loop().create_future()  

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServidor parado pelo usuário.")