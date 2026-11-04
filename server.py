"""
SPHEREx Scope 3D Backend Root Entrypoint.
Delegates to frontend/server.py so uvicorn / python can run from repo root seamlessly.
"""
import sys
from pathlib import Path

# Ensure repo root and frontend directory are in sys.path
ROOT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT_DIR / "frontend"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if str(FRONTEND_DIR) not in sys.path:
    sys.path.insert(0, str(FRONTEND_DIR))

# Import FastAPI app and all endpoints/symbols directly from frontend.server
from frontend.server import *
from frontend.server import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)

