"""Run as root after installing coturn: python3 deploy/setup-voice.py PUBLIC_IP."""
import grp
import ipaddress
import json
import os
from pathlib import Path
import secrets
import sys

public_ip = str(ipaddress.IPv4Address(sys.argv[1]))
config_dir = Path("/etc/hollowmere")
config_dir.mkdir(mode=0o700, exist_ok=True)
voice_file = config_dir / "voice.json"
secret = json.loads(voice_file.read_text())["VOICE_TURN_SECRET"] if voice_file.exists() else secrets.token_urlsafe(48)
voice_file.write_text(json.dumps({
    "VOICE_TURN_URLS": f"turn:{public_ip}:3478?transport=udp,turn:{public_ip}:3478?transport=tcp",
    "VOICE_TURN_SECRET": secret,
}) + "\n")
voice_file.chmod(0o600)
turn_file = Path("/etc/turnserver.conf")
backup = Path("/etc/turnserver.conf.before-hollowmere")
if turn_file.exists() and not backup.exists():
    backup.write_bytes(turn_file.read_bytes())
    backup.chmod(0o600)
turn_file.write_text(f"""listening-port=3478
listening-ip=0.0.0.0
external-ip={public_ip}
min-port=49160
max-port=50159
realm=hollowmere
fingerprint
use-auth-secret
static-auth-secret={secret}
stale-nonce=600
user-quota=64
total-quota=1000
max-bps=128000
bps-capacity=20000000
no-cli
no-tls
no-dtls
no-tcp-relay
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
log-file=syslog
simple-log
""")
turn_file.chmod(0o640)
os.chown(turn_file, 0, grp.getgrnam("turnserver").gr_gid)
print("Voice relay configured. Enable coturn and restart hollowmere-game using the PM2 ecosystem config.")
