#!/usr/bin/env python3
"""Ephemeral OIDC/JWKS issuer for Hotel AI OS UAT.

The RSA private key exists only in this process. Bearer tokens are written to an
ignored runtime file so smoke and browser tests can exercise the production JWT
resource-server path without committing credentials or tokens as evidence.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import signal
import stat
import tempfile
import threading
import time
import uuid
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
except ImportError as exc:  # pragma: no cover - startup guard for operators
    raise SystemExit(
        "mock_oidc_server.py requires the cryptography package. "
        "Use the bundled Codex Python runtime or install cryptography."
    ) from exc


TENANT_ID = "10000000-0000-0000-0000-000000000001"
OTHER_TENANT_ID = "10000000-0000-0000-0000-000000000099"
AUDIENCE = "hotel-ai-os-api"
ACCOUNTS = {
    "ceo": "19000000-0000-0000-0000-000000000001",
    "front-desk": "19000000-0000-0000-0000-000000000003",
    "front-supervisor": "19000000-0000-0000-0000-000000000005",
    "housekeeping-supervisor": "19000000-0000-0000-0000-000000000004",
    "assistant-gm": "19000000-0000-0000-0000-000000000008",
    "general-manager": "19000000-0000-0000-0000-000000000002",
    "regional-operations": "19000000-0000-0000-0000-000000000007",
}


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def int_b64url(value: int) -> str:
    width = max(1, (value.bit_length() + 7) // 8)
    return b64url(value.to_bytes(width, "big"))


def compact_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


class TokenIssuer:
    def __init__(self, issuer: str, audience: str, lifetime_seconds: int) -> None:
        self.issuer = issuer.rstrip("/")
        self.audience = audience
        self.lifetime_seconds = lifetime_seconds
        self.key_id = f"uat-{uuid.uuid4()}"
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_numbers = self.private_key.public_key().public_numbers()
        self.jwks = {
            "keys": [
                {
                    "kty": "RSA",
                    "kid": self.key_id,
                    "use": "sig",
                    "alg": "RS256",
                    "n": int_b64url(public_numbers.n),
                    "e": int_b64url(public_numbers.e),
                }
            ]
        }

    def token(
        self,
        *,
        account_id: str | None,
        tenant_id: str | None = TENANT_ID,
        audience: str | None = None,
        issuer: str | None = None,
        issued_at: int | None = None,
        expires_at: int | None = None,
        include_subject: bool = True,
    ) -> str:
        now = int(time.time()) if issued_at is None else issued_at
        claims: dict[str, Any] = {
            "iss": issuer or self.issuer,
            "aud": audience or self.audience,
            "iat": now,
            "nbf": now - 5,
            "exp": expires_at if expires_at is not None else now + self.lifetime_seconds,
            "jti": str(uuid.uuid4()),
            "scope": "openid hotel-ai-os",
            "token_use": "access",
        }
        if account_id is not None:
            claims["account_id"] = account_id
            if include_subject:
                claims["sub"] = account_id
        if tenant_id is not None:
            claims["tenant_id"] = tenant_id
        header = {"alg": "RS256", "kid": self.key_id, "typ": "JWT"}
        encoded_header = b64url(compact_json(header))
        encoded_claims = b64url(compact_json(claims))
        signing_input = f"{encoded_header}.{encoded_claims}".encode("ascii")
        signature = self.private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        return f"{encoded_header}.{encoded_claims}.{b64url(signature)}"

    def token_document(self) -> dict[str, Any]:
        now = int(time.time())
        tokens = {
            role: self.token(account_id=account_id)
            for role, account_id in ACCOUNTS.items()
        }
        negative_tokens = {
            "expired": self.token(
                account_id=ACCOUNTS["general-manager"],
                issued_at=now - 3600,
                expires_at=now - 60,
            ),
            "wrongAudience": self.token(
                account_id=ACCOUNTS["general-manager"], audience="hotel-ai-os-wrong-api"
            ),
            "wrongIssuer": self.token(
                account_id=ACCOUNTS["general-manager"], issuer=f"{self.issuer}/unexpected"
            ),
            "missingTenant": self.token(
                account_id=ACCOUNTS["general-manager"], tenant_id=None
            ),
            "missingIdentity": self.token(
                account_id=None, tenant_id=TENANT_ID, include_subject=False
            ),
            "unknownAccount": self.token(
                account_id="19000000-0000-0000-0000-000000000099"
            ),
            "crossTenant": self.token(
                account_id=ACCOUNTS["general-manager"], tenant_id=OTHER_TENANT_ID
            ),
        }
        return {
            "schemaVersion": 1,
            "purpose": "TECH-V0.2 local signed-JWT UAT only",
            "issuer": self.issuer,
            "audience": self.audience,
            "algorithm": "RS256",
            "keyId": self.key_id,
            "generatedAt": datetime.fromtimestamp(now, UTC).isoformat(),
            "expiresAt": datetime.fromtimestamp(now + self.lifetime_seconds, UTC).isoformat(),
            "accounts": ACCOUNTS,
            "tokens": tokens,
            "negativeTokens": negative_tokens,
        }


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        try:
            os.chmod(temp_name, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def handler_factory(token_issuer: TokenIssuer):
    discovery = {
        "issuer": token_issuer.issuer,
        "jwks_uri": f"{token_issuer.issuer}/jwks.json",
        "authorization_endpoint": f"{token_issuer.issuer}/authorize",
        "token_endpoint": f"{token_issuer.issuer}/token",
        "id_token_signing_alg_values_supported": ["RS256"],
        "response_types_supported": ["token"],
        "subject_types_supported": ["public"],
    }

    class OidcHandler(BaseHTTPRequestHandler):
        server_version = "HotelAiOsUatOidc/1.0"

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            route = self.path.split("?", 1)[0]
            if route in ("/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"):
                self.respond_json(200, discovery)
                return
            if route == "/jwks.json":
                self.respond_json(200, token_issuer.jwks)
                return
            if route == "/health":
                self.respond_json(
                    200,
                    {
                        "status": "UP",
                        "issuer": token_issuer.issuer,
                        "algorithm": "RS256",
                        "keyId": token_issuer.key_id,
                    },
                )
                return
            self.respond_json(404, {"error": "not_found"})

        def respond_json(self, status_code: int, payload: dict[str, Any]) -> None:
            raw = compact_json(payload)
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, fmt: str, *args: object) -> None:
            # Never echo request headers or bearer tokens. Only paths/status are logged.
            print(f"OIDC {self.address_string()} {fmt % args}", flush=True)

    return OidcHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an ephemeral RS256 OIDC issuer for Hotel AI OS UAT")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=18081, type=int)
    parser.add_argument("--issuer")
    parser.add_argument("--audience", default=AUDIENCE)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--lifetime-seconds", default=8 * 60 * 60, type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    issuer_url = args.issuer or f"http://{args.host}:{args.port}"
    token_issuer = TokenIssuer(issuer_url, args.audience, args.lifetime_seconds)
    atomic_write_json(args.token_file.resolve(), token_issuer.token_document())
    server = ThreadingHTTPServer((args.host, args.port), handler_factory(token_issuer))

    def stop_server(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, stop_server)

    print(
        f"UAT_OIDC_READY issuer={token_issuer.issuer} token_file={args.token_file.resolve()}",
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
