"""Private Redis CLI bridge for the opt-in WSL quota verification."""

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def run_cli(socket, args):
    return subprocess.run(
        ["redis-cli", "-s", str(socket), "--json", *map(str, args)],
        capture_output=True, text=True, timeout=10,
    )


def checked_socket(value):
    socket = Path(value)
    if (
        socket.name != "redis.sock"
        or socket.parent.parent != Path("/tmp")
        or not socket.parent.name.startswith("latihkerja-redis-")
        or socket.parent.stat().st_uid != os.getuid()
        or socket.parent.stat().st_mode & 0o077
        or not (socket.parent / "latihkerja-test").is_file()
    ):
        raise ValueError("Expected a private LatihKerja test socket")
    return socket


def main():
    action = sys.argv[1]
    if action == "start":
        directory = Path(tempfile.mkdtemp(prefix="latihkerja-redis-", dir="/tmp"))
        socket = directory / "redis.sock"
        (directory / "latihkerja-test").touch()
        try:
            subprocess.run([
                "redis-server", "--port", "0", "--unixsocket", str(socket),
                "--unixsocketperm", "700", "--protected-mode", "yes",
                "--save", "", "--appendonly", "no", "--dir", str(directory),
                "--daemonize", "yes", "--pidfile", str(directory / "redis.pid"),
                "--logfile", str(directory / "redis.log"),
            ], check=True, timeout=10)
            for _ in range(100):
                if socket.exists() and run_cli(socket, ["PING"]).stdout.strip() == '"PONG"':
                    print(json.dumps(str(socket)))
                    return
                time.sleep(0.05)
            raise RuntimeError("Disposable Redis did not answer PING")
        except Exception:
            if socket.exists():
                run_cli(socket, ["SHUTDOWN", "NOSAVE"])
            shutil.rmtree(directory)
            raise

    socket = checked_socket(sys.argv[2])
    if action == "stop":
        run_cli(socket, ["SHUTDOWN", "NOSAVE"])
        for _ in range(100):
            if not socket.exists():
                shutil.rmtree(socket.parent)
                print("true")
                return
            time.sleep(0.05)
        raise RuntimeError("Disposable Redis socket did not close")

    if action != "command":
        raise ValueError("Unknown bridge action")
    args = json.loads(base64.b64decode(sys.argv[3]))
    reply = run_cli(socket, args)
    if reply.returncode or reply.stdout.startswith("error:"):
        print(json.dumps({"error": reply.stderr.strip() or reply.stdout.strip()}))
    else:
        print(json.dumps({"result": json.loads(reply.stdout)}))


if __name__ == "__main__":
    main()
