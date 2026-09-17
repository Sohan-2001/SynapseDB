import socket
import json
import time

def send_cmd(sock, cmd):
    sock.sendall((cmd + "\r\n").encode('utf-8'))
    line = b""
    while not line.endswith(b"\r\n"):
        c = sock.recv(1)
        if not c:
            break
        line += c
    
    prefix = chr(line[0]) if line else ''
    content = line[1:-2].decode('utf-8', errors='replace') if len(line) > 2 else ''
    
    if prefix == '$':
        length = int(content)
        body = b""
        while len(body) < length:
            chunk = sock.recv(min(length - len(body), 4096))
            if not chunk:
                break
            body += chunk
        sock.recv(2) # CRLF
        return body.decode('utf-8', errors='replace')
    return content

def seed():
    print("Connecting to SynapseDB wire server at 127.0.0.1:8765...")
    s = socket.create_connection(('127.0.0.1', 8765), timeout=5.0)
    print("Connected successfully!\n")

    # -------------------------------------------------------------
    # 1. RIDES TABLE
    # -------------------------------------------------------------
    rides_data = [
        # Structured JSON with "fare"
        '{"fare": 34.50, "driver": "Alice Chen", "user_id": 1001, "rating": 4.9, "city": "New York"}',
        '{"fare": 18.25, "driver": "Bob Smith", "user_id": 1002, "rating": 4.7, "city": "Boston"}',
        '{"fare": 42.00, "driver": "David Kim", "user_id": 1003, "rating": 5.0, "city": "Chicago"}',
        '{"fare": 27.80, "driver": "Emma Davis", "user_id": 1004, "rating": 4.8, "city": "Austin"}',
        # Synonym "cost" -> automatically mapped to canonical column "amount"
        '{"cost": 55.00, "driver": "Fiona Gallagher", "user_id": 1005, "rating": 4.6, "city": "Seattle"}',
        '{"cost": 62.40, "driver": "George Clark", "user_id": 1006, "rating": 4.9, "city": "San Francisco"}',
        '{"cost": 12.50, "driver": "Hannah Abbott", "user_id": 1007, "rating": 4.5, "city": "Denver"}',
        # Synonym "price" -> automatically mapped to canonical column "amount"
        '{"price": 88.00, "driver": "Ian Malcolm", "user_id": 1008, "rating": 5.0, "city": "Miami"}',
        '{"price": 23.10, "driver": "Julia Roberts", "user_id": 1009, "rating": 4.7, "city": "Atlanta"}',
        # Unstructured text logs (SLM entity extraction: driver, amount, user_id, city)
        'Driver Carlos Mendez completed airport pickup ride for $68.50 user_id=1010 city=Chicago',
        'Driver Evan Wright completed VIP limousine ride for $145.00 user_id=1011 city=New York',
        'Driver Maya Lin completed downtown dropoff for $19.75 user_id=1012 city=Boston',
    ]

    print(f"[*] Ingesting {len(rides_data)} records into table 'rides'...")
    for item in rides_data:
        t0 = time.perf_counter()
        resp = send_cmd(s, f"PUSH rides {item}")
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"  • PUSH rides -> RowID #{resp} ({dt:.2f} ms)")

    # -------------------------------------------------------------
    # 2. ORDERS TABLE (E-Commerce)
    # -------------------------------------------------------------
    orders_data = [
        '{"amount": 899.99, "customer": "David Miller", "product": "Ultra HD Monitor 34-inch", "category": "Electronics", "status": "shipped"}',
        '{"amount": 49.50, "customer": "Emma Watson", "product": "Wireless Mechanical Keyboard", "category": "Accessories", "status": "delivered"}',
        '{"amount": 125.00, "customer": "Lucas Gray", "product": "Noise-Cancelling Headphones", "category": "Audio", "status": "processing"}',
        '{"amount": 19.99, "customer": "Oliver Brown", "product": "USB-C Fast Charging Hub", "category": "Accessories", "status": "delivered"}',
        '{"amount": 450.00, "customer": "Sophia Taylor", "product": "Smartphone 5G 128GB", "category": "Electronics", "status": "shipped"}',
        '{"amount": 35.00, "customer": "James Wilson", "product": "Ergonomic Mouse Pad", "category": "Accessories", "status": "delivered"}',
        '{"amount": 210.00, "customer": "Ava Martinez", "product": "Smart Fitness Watch", "category": "Wearables", "status": "processing"}',
        '{"cost": 75.00, "customer": "Liam Johnson", "product": "Bluetooth Portable Speaker", "category": "Audio", "status": "delivered"}',
        '{"cost": 1599.00, "customer": "Noah Anderson", "product": "Gaming Laptop RTX 4070", "category": "Computers", "status": "shipped"}',
        '{"price": 320.00, "customer": "Isabella Thomas", "product": "Standing Desk Converter", "category": "Furniture", "status": "delivered"}',
        'Customer Ethan White purchased Ergonomic Office Chair for $249.00 status=delivered',
        'Customer Mia Harris placed expedited order for $89.90 status=shipped',
    ]

    print(f"\n[*] Ingesting {len(orders_data)} records into table 'orders'...")
    for item in orders_data:
        t0 = time.perf_counter()
        resp = send_cmd(s, f"PUSH orders {item}")
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"  • PUSH orders -> RowID #{resp} ({dt:.2f} ms)")

    # -------------------------------------------------------------
    # 3. IOT_SENSORS TABLE (Industrial Telemetry)
    # -------------------------------------------------------------
    sensors_data = [
        '{"device_id": "sensor_north_01", "temperature": 72.4, "humidity": 45.2, "pressure": 1013.25, "location": "Building A", "status": "normal"}',
        '{"device_id": "sensor_south_02", "temperature": 86.8, "humidity": 62.1, "pressure": 1010.50, "location": "Warehouse B", "status": "warning"}',
        '{"device_id": "sensor_east_03", "temperature": 68.1, "humidity": 40.0, "pressure": 1015.00, "location": "Server Room", "status": "normal"}',
        '{"device_id": "sensor_west_04", "temperature": 94.5, "humidity": 71.2, "pressure": 1008.10, "location": "Boiler Room", "status": "critical"}',
        '{"device_id": "sensor_central_05", "temperature": 70.0, "humidity": 48.5, "pressure": 1012.80, "location": "Building A", "status": "normal"}',
        '{"device_id": "sensor_rooftop_06", "temperature": 65.3, "humidity": 55.0, "pressure": 1014.20, "location": "Rooftop HVAC", "status": "normal"}',
        '{"device_id": "sensor_coldroom_07", "temperature": 38.2, "humidity": 82.0, "pressure": 1011.90, "location": "Cold Storage", "status": "normal"}',
        'Telemetry device_id=sensor_backup_08 temperature=75.1 humidity=50.3 pressure=1013.0 status=normal',
    ]

    print(f"\n[*] Ingesting {len(sensors_data)} records into table 'iot_sensors'...")
    for item in sensors_data:
        t0 = time.perf_counter()
        resp = send_cmd(s, f"PUSH iot_sensors {item}")
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"  • PUSH iot_sensors -> RowID #{resp} ({dt:.2f} ms)")

    # -------------------------------------------------------------
    # 4. WEB_LOGS TABLE (API Traffic & Latency)
    # -------------------------------------------------------------
    logs_data = [
        '{"endpoint": "/api/v1/checkout", "method": "POST", "status_code": 200, "duration_ms": 14.2, "user_id": 501}',
        '{"endpoint": "/api/v1/products", "method": "GET", "status_code": 200, "duration_ms": 3.8, "user_id": 502}',
        '{"endpoint": "/api/v1/auth/login", "method": "POST", "status_code": 401, "duration_ms": 22.5, "user_id": 503}',
        '{"endpoint": "/api/v1/search", "method": "GET", "status_code": 200, "duration_ms": 8.1, "user_id": 504}',
        '{"endpoint": "/api/v1/user/profile", "method": "GET", "status_code": 200, "duration_ms": 4.5, "user_id": 505}',
        '{"endpoint": "/api/v1/orders/history", "method": "GET", "status_code": 200, "duration_ms": 19.3, "user_id": 506}',
        '{"endpoint": "/api/v1/cart/add", "method": "POST", "status_code": 200, "duration_ms": 6.7, "user_id": 507}',
        '{"endpoint": "/api/v1/payment/stripe", "method": "POST", "status_code": 500, "duration_ms": 154.2, "user_id": 508}',
        'API log GET /api/v1/telemetry status_code=200 duration_ms=5.1 user_id=509',
        'API log POST /api/v1/feedback status_code=201 duration_ms=12.0 user_id=510',
    ]

    print(f"\n[*] Ingesting {len(logs_data)} records into table 'web_logs'...")
    for item in logs_data:
        t0 = time.perf_counter()
        resp = send_cmd(s, f"PUSH web_logs {item}")
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"  • PUSH web_logs -> RowID #{resp} ({dt:.2f} ms)")

    # -------------------------------------------------------------
    # 5. FLUSH MICRO-BATCH RING BUFFER TO COLUMNAR CHUNKS
    # -------------------------------------------------------------
    print("\n[*] Flushing all in-flight buffers to columnar storage...")
    t0 = time.perf_counter()
    flush_resp = send_cmd(s, "FLUSH")
    dt = (time.perf_counter() - t0) * 1000.0
    print(f"  • FLUSH response: {flush_resp} (drained in {dt:.2f} ms)")

    # -------------------------------------------------------------
    # 6. VERIFY DISCOVERED SCHEMAS & ROW COUNTS
    # -------------------------------------------------------------
    print("\n" + "=" * 60)
    print("           SYNAPSEDB ACTIVE TABLES & SCHEMAS")
    print("=" * 60)

    tables_resp = send_cmd(s, "SCHEMA")
    try:
        tables_json = json.loads(tables_resp)
        table_list = tables_json.get("tables", [])
        for tbl in table_list:
            schema_resp = send_cmd(s, f"SCHEMA {tbl}")
            s_obj = json.loads(schema_resp)
            row_cnt = s_obj.get("row_count", 0)
            cols = [f"{c['name']} ({c['type']})" for c in s_obj.get("columns", [])]
            print(f"\n[TABLE] Table: '{tbl}' | Total Rows: {row_cnt}")
            print(f"        Columns ({len(cols)}): {', '.join(cols)}")
    except Exception as e:
        print(f"Schema inspect error: {e}")

    s.close()
    print("\n" + "=" * 60)
    print("  ALL TEST DATA PUSHED AND COMMITTED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    seed()
