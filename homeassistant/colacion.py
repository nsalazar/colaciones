#!/usr/bin/env python3
"""
Lee schedule.json del sitio publicado y entrega, en JSON, el proximo dia habil
con colacion o actividades. Pensado para un command_line sensor de Home Assistant.

Uso:
    colacion.py                      -> lee la URL de abajo
    colacion.py ruta/schedule.json   -> lee un archivo local (para probar)
"""

import json
import sys
import urllib.request
from datetime import date, timedelta

URL = "https://TU-USUARIO.github.io/colacion-kinder/data/schedule.json"
HORIZONTE = 420          # dias que se recorren desde rotationStart
VENTANA = 14             # cuantos dias mirar hacia adelante buscando el proximo turno

DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
         "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def parse(s):
    y, m, d = (int(x) for x in s.split("-"))
    return date(y, m, d)


def expandir_cierres(cfg):
    out = {}
    for c in cfg.get("closures", []):
        item = {"type": c.get("type", "sinClases"), "reason": c.get("reason", "")}
        if "date" in c:
            out[c["date"]] = item
        elif "from" in c and "to" in c:
            d, fin = parse(c["from"]), parse(c["to"])
            while d <= fin:
                out[d.isoformat()] = item
                d += timedelta(days=1)
    return out


def expandir_eventos(cfg):
    out = {}
    for e in cfg.get("events", []):
        fechas = []
        if "date" in e:
            fechas = [e["date"]]
        elif "from" in e and "to" in e:
            d, fin = parse(e["from"]), parse(e["to"])
            while d <= fin:
                fechas.append(d.isoformat())
                d += timedelta(days=1)
        for f in fechas:
            out.setdefault(f, []).append(e)
    return out


def construir_turnos(cfg, cierres):
    turnos = {}
    d = parse(cfg["rotationStart"])
    fin = d + timedelta(days=HORIZONTE)
    i = 0
    while d <= fin:
        iso = d.isoformat()
        comida = cfg["weekdays"].get(str(d.isoweekday()))
        if comida and iso not in cierres:
            turnos[iso] = {"meal": comida, "kid": cfg["kids"][i % len(cfg["kids"])]}
            i += 1
        d += timedelta(days=1)

    for o in cfg.get("overrides", []):
        if o["date"] in turnos:
            turnos[o["date"]]["kid"] = o["kid"]
            turnos[o["date"]]["note"] = o.get("note", "cambio")
    return turnos


def texto_fecha(d):
    return f"{DIAS[d.weekday()]} {d.day} de {MESES[d.month - 1]}"


def main():
    origen = sys.argv[1] if len(sys.argv) > 1 else URL
    if origen.startswith("http"):
        with urllib.request.urlopen(origen, timeout=20) as r:
            cfg = json.load(r)
    else:
        with open(origen, encoding="utf-8") as f:
            cfg = json.load(f)

    cierres = expandir_cierres(cfg)
    eventos = expandir_eventos(cfg)
    turnos = construir_turnos(cfg, cierres)

    hoy = date.today()
    for n in range(1, VENTANA + 1):
        d = hoy + timedelta(days=n)
        iso = d.isoformat()
        if d.isoweekday() > 5:
            continue

        turno = turnos.get(iso)
        cierre = cierres.get(iso)
        evs = eventos.get(iso, [])

        # nada que avisar: sigue buscando
        if not turno and not evs and not (cierre and cierre["type"] == "sinColacion"):
            continue

        lineas = [f"Recordatorio {cfg.get('curso', '')} — {texto_fecha(d)}"]
        if turno:
            linea = f"Colacion: {turno['meal']} — le toca a {turno['kid']}"
            if turno.get("note"):
                linea += f" ({turno['note']})"
            lineas.append(linea)
        elif cierre and cierre["type"] == "sinColacion":
            lineas.append(f"NO enviar colacion: {cierre['reason']}")

        for e in evs:
            extra = f" {e['time']}" if e.get("time") else ""
            lugar = e.get("place") or e.get("note") or ""
            lineas.append(f"{e['title']}{extra}" + (f" — {lugar}" if lugar else ""))

        print(json.dumps({
            "estado": turno["kid"] if turno else "sin_turno",
            "fecha": iso,
            "dia": DIAS[d.weekday()],
            "comida": turno["meal"] if turno else None,
            "nino": turno["kid"] if turno else None,
            "sin_colacion": bool(cierre and cierre["type"] == "sinColacion"),
            "eventos": [e["title"] for e in evs],
            "mensaje": "\n".join(lineas),
        }, ensure_ascii=False))
        return

    print(json.dumps({"estado": "nada", "mensaje": "", "eventos": []}, ensure_ascii=False))


if __name__ == "__main__":
    main()
