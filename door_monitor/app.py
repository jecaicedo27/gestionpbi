"""
door_monitor/app.py
Servicio FastAPI — YOLOv8 (detección) + InsightFace ArcFace (identificación).
Puerto: 3063
"""

import os
import uuid
import json
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import cv2
import numpy as np
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from insightface.app import FaceAnalysis

from tracker import CentroidTracker

# ── Config ────────────────────────────────────────────────────────────────────

DB_DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://mrp_user:mrp_password_123@localhost:5432/gestionpbi"
)
SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "snapshots")
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

YOLO_CONF       = 0.40
FACE_THRESHOLD  = 0.50   # distancia coseno — menor = más parecido
MODEL_NAME      = "yolov8n.pt"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [door-monitor] %(message)s")
log = logging.getLogger(__name__)

# ── Globals ───────────────────────────────────────────────────────────────────

yolo_model:   YOLO | None       = None
face_app:     FaceAnalysis | None = None
trackers:     dict[str, CentroidTracker] = {}
source_stats: dict[str, dict]            = {}

# Cache de descriptores enrolados: {employee_id: {name, embedding}}
enrolled_cache: dict[str, dict] = {}
cache_loaded = False


def get_tracker(source_id: str) -> CentroidTracker:
    if source_id not in trackers:
        trackers[source_id] = CentroidTracker()
    return trackers[source_id]


def update_stats(source_id: str, persons: int, has_crossing: bool):
    if source_id not in source_stats:
        source_stats[source_id] = {
            "frames": 0, "persons_total": 0, "frames_with_person": 0,
            "crossings": 0, "last_seen": None,
        }
    s = source_stats[source_id]
    s["frames"]             += 1
    s["persons_total"]      += persons
    s["frames_with_person"] += (1 if persons > 0 else 0)
    s["crossings"]          += (1 if has_crossing else 0)
    s["last_seen"]           = datetime.now(timezone.utc).isoformat()


# ── DB helpers ────────────────────────────────────────────────────────────────

def db_conn():
    return psycopg2.connect(DB_DSN)


def load_enrolled():
    """Carga/recarga los descriptores InsightFace desde la DB al cache en memoria."""
    global enrolled_cache, cache_loaded
    try:
        conn = db_conn()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, name, face_descriptor_insightface FROM shift_employees "
            "WHERE active = true AND face_descriptor_insightface IS NOT NULL"
        )
        rows = cur.fetchall()
        cur.close(); conn.close()
        enrolled_cache = {
            str(r["id"]): {
                "name":      r["name"],
                "embedding": np.array(r["face_descriptor_insightface"], dtype=np.float32),
            }
            for r in rows
        }
        cache_loaded = True
        log.info(f"Cache de identidades cargado: {len(enrolled_cache)} empleados enrolados")
    except Exception as e:
        log.error(f"Error cargando cache de identidades: {e}")


def cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-10)
    b = b / (np.linalg.norm(b) + 1e-10)
    return float(1.0 - np.dot(a, b))


def identify_face(embedding: np.ndarray) -> tuple[str | None, str | None, float]:
    """Compara embedding contra cache. Retorna (employee_id, name, distance)."""
    if not enrolled_cache:
        return None, None, 1.0
    best_id, best_name, best_dist = None, None, 1.0
    for eid, data in enrolled_cache.items():
        dist = cosine_distance(embedding, data["embedding"])
        if dist < best_dist:
            best_dist = dist
            best_id   = eid
            best_name = data["name"]
    if best_dist <= FACE_THRESHOLD:
        return best_id, best_name, best_dist
    return None, None, best_dist


def store_crossing(crossing: dict, source: str):
    snapshot_url = None
    raw = crossing.get("snapshot")
    if raw is not None:
        fname = f"{uuid.uuid4()}.jpg"
        path  = os.path.join(SNAPSHOT_DIR, fname)
        cv2.imwrite(path, raw)
        snapshot_url = f"/door-snapshots/{fname}"

    try:
        conn = db_conn()
        cur  = conn.cursor()
        cur.execute(
            """INSERT INTO door_crossing_events
               (direction, confidence, snapshot_path, bbox_area_start, bbox_area_end,
                source, employee_id, employee_name, identity_confidence)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                crossing["direction"], crossing["confidence"],
                snapshot_url, crossing["area_start"], crossing["area_end"],
                source,
                crossing.get("employee_id"),
                crossing.get("employee_name"),
                crossing.get("identity_confidence"),
            ),
        )
        conn.commit(); cur.close(); conn.close()
        name = crossing.get("employee_name") or "desconocido"
        log.info(
            f"CRUCE [{source}]: {crossing['direction']} | {name} "
            f"conf={crossing['confidence']:.2f} id_dist={crossing.get('identity_confidence', '?')}"
        )
    except Exception as e:
        log.error(f"DB store_crossing error: {e}")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global yolo_model, face_app
    log.info("Cargando YOLOv8n...")
    yolo_model = YOLO(MODEL_NAME)
    dummy = np.zeros((320, 320, 3), dtype=np.uint8)
    yolo_model(dummy, classes=[0], conf=YOLO_CONF, verbose=False)

    log.info("Cargando InsightFace buffalo_sc...")
    face_app = FaceAnalysis(name="buffalo_sc", providers=["CPUExecutionProvider"])
    face_app.prepare(ctx_id=0, det_size=(320, 320))

    load_enrolled()
    log.info(f"Servicio listo en :3063 — {len(enrolled_cache)} identidades cargadas")
    yield
    log.info("Cerrando door-monitor...")


app = FastAPI(title="Door Monitor + Face ID", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":           "ok",
        "yolo":             MODEL_NAME,
        "face_model":       "buffalo_sc (ArcFace)",
        "enrolled":         len(enrolled_cache),
        "active_sources":   list(trackers.keys()),
        "active_tracks":    {sid: t.active_count() for sid, t in trackers.items()},
    }


@app.post("/enroll/{employee_id}")
async def enroll(employee_id: str, file: UploadFile = File(...)):
    """
    Enrola o actualiza el descriptor InsightFace de un empleado.
    Acepta una foto JPEG/PNG con la cara visible.
    """
    raw   = await file.read()
    arr   = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Imagen inválida")

    faces = face_app.get(frame)
    if not faces:
        raise HTTPException(422, "No se detectó ninguna cara en la imagen")

    # Tomar la cara más grande (más prominente)
    face = max(faces, key=lambda f: (f.bbox[2]-f.bbox[0]) * (f.bbox[3]-f.bbox[1]))
    embedding = face.embedding.tolist()

    # Verificar que el empleado existe
    conn = db_conn()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, name FROM shift_employees WHERE id = %s", (employee_id,))
    emp = cur.fetchone()
    if not emp:
        cur.close(); conn.close()
        raise HTTPException(404, "Empleado no encontrado")

    # Guardar embedding
    cur.execute(
        "UPDATE shift_employees SET face_descriptor_insightface = %s WHERE id = %s",
        (json.dumps(embedding), employee_id)
    )
    conn.commit(); cur.close(); conn.close()

    # Recargar cache
    load_enrolled()

    log.info(f"Enrolado InsightFace: {emp['name']} ({employee_id})")
    return {"success": True, "employee": emp["name"], "embedding_size": len(embedding)}


@app.post("/reload-enrolled")
def reload_enrolled():
    """Recarga el cache de descriptores desde la DB (útil tras enrolar desde otro proceso)."""
    load_enrolled()
    return {"enrolled": len(enrolled_cache)}


@app.post("/process-frame")
async def process_frame(
    file:      UploadFile = File(...),
    source_id: str        = "tablet_kiosk",
):
    raw   = await file.read()
    arr   = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Frame inválido")

    h, w = frame.shape[:2]
    infer_w     = 640
    infer_frame = cv2.resize(frame, (infer_w, int(h * infer_w / w)))

    # ── Detección de personas (YOLOv8) ────────────────────────────────────────
    results = yolo_model(infer_frame, classes=[0], conf=YOLO_CONF, verbose=False)[0]

    centroids, areas, face_embeddings = [], [], []
    detections = []

    for box in results.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        conf = float(box.conf[0])
        area = (x2 - x1) * (y2 - y1)
        cx   = int((x1 + x2) / 2)
        cy   = int((y1 + y2) / 2)

        # ── Identificación facial dentro del bounding box ─────────────────────
        person_crop = infer_frame[max(0,int(y1)):int(y2), max(0,int(x1)):int(x2)]
        embedding   = None
        if person_crop.size > 0 and enrolled_cache:
            try:
                faces = face_app.get(person_crop)
                if faces:
                    best_face = max(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]))
                    embedding = best_face.embedding
            except Exception:
                pass

        centroids.append((cx, cy))
        areas.append(area)
        face_embeddings.append(embedding)
        detections.append({"bbox": [x1,y1,x2,y2], "conf": round(conf,3), "area": round(area,1)})

    # ── Tracker ───────────────────────────────────────────────────────────────
    trk      = get_tracker(source_id)
    crossings = trk.update(centroids, areas, infer_frame, face_embeddings)

    # ── Identificar y persistir cruces ───────────────────────────────────────
    for crossing in crossings:
        best_emb = crossing.get("best_embedding")
        if best_emb is not None and enrolled_cache:
            eid, ename, dist = identify_face(best_emb)
            crossing["employee_id"]          = eid
            crossing["employee_name"]        = ename
            crossing["identity_confidence"]  = round(1.0 - dist, 3) if eid else None
        else:
            crossing["employee_id"]         = None
            crossing["employee_name"]       = None
            crossing["identity_confidence"] = None
        store_crossing(crossing, source_id)

    update_stats(source_id, len(detections), len(crossings) > 0)

    if detections:
        names = [c.get("employee_name") or "?" for c in crossings]
        log.info(f"[{source_id}] {len(detections)} persona(s) | cruces: {len(crossings)} {names}")

    safe_crossings = [
        {k: v for k, v in c.items() if k not in ("snapshot", "best_embedding")}
        for c in crossings
    ]

    return {
        "persons_detected": len(detections),
        "detections":       detections,
        "crossings":        safe_crossings,
        "active_tracks":    trk.active_count(),
        "source_id":        source_id,
    }


@app.get("/compare")
def compare():
    result = []
    for sid, s in source_stats.items():
        rate = round(s["frames_with_person"] / s["frames"] * 100, 1) if s["frames"] > 0 else 0
        result.append({
            "source_id":           sid,
            "frames_received":     s["frames"],
            "frames_with_person":  s["frames_with_person"],
            "detection_rate_pct":  rate,
            "persons_detected":    s["persons_total"],
            "crossings_logged":    s["crossings"],
            "last_seen":           s["last_seen"],
            "active_tracks":       trackers[sid].active_count() if sid in trackers else 0,
        })
    result.sort(key=lambda x: x["detection_rate_pct"], reverse=True)
    return {"sources": result, "enrolled_identities": len(enrolled_cache)}


@app.get("/stats")
def stats():
    try:
        conn = db_conn()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT direction, employee_name,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today,
                   ROUND(AVG(identity_confidence)::numeric, 3) AS avg_id_confidence
            FROM door_crossing_events
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY direction, employee_name
            ORDER BY today DESC
        """)
        rows = cur.fetchall()
        cur.close(); conn.close()
        return {"stats": rows, "enrolled": len(enrolled_cache)}
    except Exception as e:
        raise HTTPException(500, str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3063, log_level="info")
