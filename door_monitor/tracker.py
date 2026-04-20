"""
tracker.py — Centroid tracker con detección de dirección por área de bounding box.

Lógica para cámara frontal (tablet mirando hacia producción):
  - Persona que se ACERCA a la cámara → bounding box crece → SALE de producción (va a descanso)
  - Persona que se ALEJA de la cámara → bounding box encoge → ENTRA a producción (regresa del descanso)
"""

import numpy as np
from collections import OrderedDict


class CentroidTracker:
    def __init__(
        self,
        max_disappeared: int = 8,     # frames sin detección antes de cerrar track
        min_frames: int = 2,          # mínimo de frames para contar el cruce
        min_area_change: float = 0.20, # cambio mínimo de área (20%) para determinar dirección
        max_match_dist: int = 160,     # distancia máxima para asociar detección con track
    ):
        self.next_id = 0
        self.objects: OrderedDict[int, dict] = OrderedDict()
        self.disappeared: OrderedDict[int, int] = OrderedDict()

        self.max_disappeared = max_disappeared
        self.min_frames = min_frames
        self.min_area_change = min_area_change
        self.max_match_dist = max_match_dist

    # ── internal ──────────────────────────────────────────────────────────────

    def _register(self, centroid, area, frame_copy, embedding=None):
        self.objects[self.next_id] = {
            "centroid":       centroid,
            "areas":          [area],
            "frames":         1,
            "first_snapshot": frame_copy,
            "last_snapshot":  frame_copy,
            "embeddings":     [embedding] if embedding is not None else [],
        }
        self.disappeared[self.next_id] = 0
        self.next_id += 1

    def _deregister(self, oid) -> dict | None:
        obj = self.objects.pop(oid, None)
        self.disappeared.pop(oid, None)
        return obj

    def _determine_direction(self, areas: list) -> tuple[str | None, float]:
        if len(areas) < 3:
            return None, 0.0
        first = float(np.mean(areas[: max(3, len(areas) // 4)]))
        last  = float(np.mean(areas[-max(3, len(areas) // 4):]))
        if first < 1:
            return None, 0.0
        ratio = (last - first) / first
        if ratio > self.min_area_change:
            return "EXIT_PRODUCTION", min(abs(ratio), 1.0)   # se acercó → sale de producción
        if ratio < -self.min_area_change:
            return "ENTER_PRODUCTION", min(abs(ratio), 1.0)  # se alejó → entra a producción
        return None, 0.0

    def _resolve_track(self, obj: dict) -> dict | None:
        """Evalúa si un track cerrado genera un evento de cruce."""
        if obj["frames"] < self.min_frames:
            return None
        direction, conf = self._determine_direction(obj["areas"])
        if not direction:
            return None
        # Mejor embedding del track (el que no es None)
        embs = [e for e in obj.get("embeddings", []) if e is not None]
        best_emb = embs[len(embs)//2] if embs else None  # el del frame central
        return {
            "direction":      direction,
            "confidence":     round(conf, 3),
            "area_start":     round(obj["areas"][0], 1),
            "area_end":       round(obj["areas"][-1], 1),
            "frame_count":    obj["frames"],
            "snapshot":       obj.get("last_snapshot"),
            "best_embedding": best_emb,
        }

    # ── public ────────────────────────────────────────────────────────────────

    def update(self, centroids: list, areas: list, frame=None, embeddings: list = None) -> list[dict]:
        """
        Actualiza el tracker con nuevas detecciones.
        Retorna lista de cruces confirmados en este frame (puede ser vacía).
        """
        crossings  = []
        frame_copy = frame.copy() if frame is not None else None
        if embeddings is None:
            embeddings = [None] * len(centroids)

        # Sin detecciones: incrementar desapariciones
        if len(centroids) == 0:
            for oid in list(self.disappeared):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    obj = self._deregister(oid)
                    if obj:
                        ev = self._resolve_track(obj)
                        if ev:
                            crossings.append(ev)
            return crossings

        # Sin tracks activos: registrar todos
        if len(self.objects) == 0:
            for c, a, e in zip(centroids, areas, embeddings):
                self._register(c, a, frame_copy, e)
            return crossings

        # Calcular matriz de distancias entre tracks y detecciones
        oids = list(self.objects.keys())
        obj_cents = np.array([self.objects[oid]["centroid"] for oid in oids], dtype=float)
        new_cents = np.array(centroids, dtype=float)

        D = np.linalg.norm(obj_cents[:, None] - new_cents[None, :], axis=2)
        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows, used_cols = set(), set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
            if D[row, col] > self.max_match_dist:
                continue
            oid = oids[row]
            self.objects[oid]["centroid"]      = centroids[col]
            self.objects[oid]["areas"].append(areas[col])
            self.objects[oid]["frames"]       += 1
            self.objects[oid]["last_snapshot"] = frame_copy
            if embeddings[col] is not None:
                self.objects[oid]["embeddings"].append(embeddings[col])
            self.disappeared[oid] = 0
            used_rows.add(row)
            used_cols.add(col)

        # Tracks sin match → incrementar desaparición
        for row in set(range(len(oids))) - used_rows:
            oid = oids[row]
            self.disappeared[oid] += 1
            if self.disappeared[oid] > self.max_disappeared:
                obj = self._deregister(oid)
                if obj:
                    ev = self._resolve_track(obj)
                    if ev:
                        crossings.append(ev)

        # Detecciones sin match → nuevo track
        for col in set(range(len(centroids))) - used_cols:
            self._register(centroids[col], areas[col], frame_copy)

        return crossings

    def active_count(self) -> int:
        return len(self.objects)
