import socket
import threading
import time
from wsgiref.simple_server import make_server

import webview

from app import app


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> None:
    port = _find_free_port()
    url = f"http://127.0.0.1:{port}"
    server = make_server("127.0.0.1", port, app)

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    time.sleep(0.6)

    window = webview.create_window(
        "Image Runner",
        url,
        width=1320,
        height=900,
        min_size=(980, 760),
        text_select=True,
    )

    try:
        webview.start()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()