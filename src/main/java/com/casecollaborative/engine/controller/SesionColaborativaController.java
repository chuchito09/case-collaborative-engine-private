package com.casecollaborative.engine.controller;

import com.casecollaborative.engine.dto.websocket.DiagramaSnapshotDTO;
import com.casecollaborative.engine.dto.websocket.SesionResponse;
import com.casecollaborative.engine.model.entity.*;
import com.casecollaborative.engine.repository.*;
import com.casecollaborative.engine.security.CustomUserDetails;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

@RestController
@RequestMapping("/api/v1/sesiones")
public class SesionColaborativaController {

    private final SesionColaborativaRepository sesionRepository;
    private final ProyectoRepository proyectoRepository;
    private final ProyectoColaboradorRepository colaboradorRepository;
    private final DiagramaUmlRepository diagramaRepository;
    private final ClaseRepository claseRepository;
    private final AtributoRepository atributoRepository;
    private final RelacionClaseRepository relacionRepository;
    private final UsuarioRepository usuarioRepository;

    public SesionColaborativaController(SesionColaborativaRepository sesionRepository,
                                        ProyectoRepository proyectoRepository,
                                        ProyectoColaboradorRepository colaboradorRepository,
                                        DiagramaUmlRepository diagramaRepository,
                                        ClaseRepository claseRepository,
                                        AtributoRepository atributoRepository,
                                        RelacionClaseRepository relacionRepository,
                                        UsuarioRepository usuarioRepository) {
        this.sesionRepository = sesionRepository;
        this.proyectoRepository = proyectoRepository;
        this.colaboradorRepository = colaboradorRepository;
        this.diagramaRepository = diagramaRepository;
        this.claseRepository = claseRepository;
        this.atributoRepository = atributoRepository;
        this.relacionRepository = relacionRepository;
        this.usuarioRepository = usuarioRepository;
    }

    public record CrearSesionRequest(Long proyectoId) {}

    @PostMapping("/crear")
    public ResponseEntity<SesionResponse> crearSesion(@RequestBody CrearSesionRequest request,
                                                      @AuthenticationPrincipal CustomUserDetails userDetails) {
        Long usuarioId = userDetails.getId();
        Proyecto proyecto = proyectoRepository.findById(request.proyectoId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Proyecto no encontrado"));

        boolean esPropietario = proyecto.getPropietario().getId().equals(usuarioId);
        boolean esColaborador = colaboradorRepository.existsById(new ProyectoColaboradorId(proyecto.getId(), usuarioId));

        if (!esPropietario && !esColaborador) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No tiene permisos para este proyecto");
        }

        SesionColaborativa sesion = new SesionColaborativa();
        sesion.setProyecto(proyecto);
        sesion.setSessionToken(UUID.randomUUID().toString());
        sesion.setHostUsuario(usuarioRepository.getReferenceById(usuarioId));
        sesion.setActiva(true);

        sesion = sesionRepository.save(sesion);

        return ResponseEntity.ok(new SesionResponse(
                sesion.getId(), sesion.getProyecto().getId(), sesion.getSessionToken(), sesion.getHostUsuario().getId(), sesion.getActiva()
        ));
    }

    @PostMapping("/{sessionToken}/unirse")
    @Transactional
    public ResponseEntity<DiagramaSnapshotDTO> unirseSesion(@PathVariable String sessionToken,
                                                            @AuthenticationPrincipal CustomUserDetails userDetails) {
        Long usuarioId = userDetails.getId();
        SesionColaborativa sesion = sesionRepository.findBySessionToken(sessionToken)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Sesión no encontrada"));

        if (!sesion.getActiva()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La sesión no está activa");
        }

        Proyecto proyecto = proyectoRepository.findById(sesion.getProyecto().getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Proyecto no encontrado"));

        if (!proyecto.getPropietario().getId().equals(usuarioId)) {
            ProyectoColaboradorId pcId = new ProyectoColaboradorId(proyecto.getId(), usuarioId);
            if (!colaboradorRepository.existsById(pcId)) {
                ProyectoColaborador pc = new ProyectoColaborador();
                pc.setId(pcId);
                pc.setProyecto(proyecto);
                pc.setColaborador(usuarioRepository.getReferenceById(usuarioId));
                colaboradorRepository.save(pc);
            }
        }

        var diagrama = diagramaRepository.findByProyectoId(proyecto.getId())
                .orElseGet(() -> {
                    com.casecollaborative.engine.model.entity.DiagramaUml d = new com.casecollaborative.engine.model.entity.DiagramaUml();
                    d.setProyecto(proyecto);
                    d.setNombre(proyecto.getNombre());
                    d.setVersion(1);
                    d.setZoomCanvas(1.0);
                    d.setPanX(0.0);
                    d.setPanY(0.0);
                    return diagramaRepository.save(d);
                });

        var clases = claseRepository.findByDiagramaId(diagrama.getId());
        var relaciones = relacionRepository.findByDiagramaId(diagrama.getId());

        return ResponseEntity.ok(new DiagramaSnapshotDTO(
                diagrama.getId(), proyecto.getId(), diagrama.getNombre(), diagrama.getVersion(),
                diagrama.getZoomCanvas(), diagrama.getPanX(), diagrama.getPanY(),
                clases, relaciones
        ));
    }

    @PostMapping("/{sessionToken}/guardar")
    @Transactional
    public ResponseEntity<DiagramaSnapshotDTO> guardarAvancePorSesion(@PathVariable String sessionToken,
                                                                      @RequestBody Map<String, Object> payload,
                                                                      @AuthenticationPrincipal CustomUserDetails userDetails) {
        SesionColaborativa sesion = sesionRepository.findBySessionToken(sessionToken)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Sesión no encontrada"));
        return guardarDiagramaInterno(sesion.getProyecto(), payload);
    }

    @PostMapping("/proyecto/{proyectoId}/guardar")
    @Transactional
    public ResponseEntity<DiagramaSnapshotDTO> guardarAvancePorProyecto(@PathVariable Long proyectoId,
                                                                        @RequestBody Map<String, Object> payload,
                                                                        @AuthenticationPrincipal CustomUserDetails userDetails) {
        Proyecto proyecto = proyectoRepository.findById(proyectoId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Proyecto no encontrado"));
        return guardarDiagramaInterno(proyecto, payload);
    }

    private ResponseEntity<DiagramaSnapshotDTO> guardarDiagramaInterno(Proyecto proyecto, Map<String, Object> payload) {
        DiagramaUml diagrama = diagramaRepository.findByProyectoId(proyecto.getId())
                .orElseGet(() -> {
                    DiagramaUml d = new DiagramaUml();
                    d.setProyecto(proyecto);
                    d.setNombre(proyecto.getNombre());
                    d.setVersion(1);
                    d.setZoomCanvas(1.0);
                    d.setPanX(0.0);
                    d.setPanY(0.0);
                    return diagramaRepository.save(d);
                });

        if (payload.get("zoomCanvas") != null) {
            diagrama.setZoomCanvas(Double.parseDouble(payload.get("zoomCanvas").toString()));
        }
        if (payload.get("panX") != null) {
            diagrama.setPanX(Double.parseDouble(payload.get("panX").toString()));
        }
        if (payload.get("panY") != null) {
            diagrama.setPanY(Double.parseDouble(payload.get("panY").toString()));
        }
        diagrama = diagramaRepository.save(diagrama);

        // Mapa de clientId -> Clase entity guardada
        Map<String, Clase> clasesGuardadas = new HashMap<>();

        if (payload.get("clases") instanceof List<?> clasesList) {
            for (Object objClase : clasesList) {
                if (objClase instanceof Map<?, ?> cMap) {
                    String clientId = cMap.get("clientId") != null ? cMap.get("clientId").toString() : (cMap.get("id") != null ? cMap.get("id").toString() : null);
                    Long claseId = null;
                    if (cMap.get("id") != null && !cMap.get("id").toString().startsWith("temp-")) {
                        try {
                            claseId = Long.parseLong(cMap.get("id").toString());
                        } catch (Exception ignored) {}
                    }

                    Clase clase = (claseId != null) ? claseRepository.findById(claseId).orElse(new Clase()) : new Clase();
                    clase.setDiagrama(diagrama);
                    clase.setNombre(cMap.get("nombre") != null ? cMap.get("nombre").toString() : "Clase");
                    clase.setEstereotipo(cMap.get("estereotipo") != null ? cMap.get("estereotipo").toString() : "CLASS");
                    clase.setVisibilidad(cMap.get("visibilidad") != null ? cMap.get("visibilidad").toString() : "public");
                    clase.setPosX(cMap.get("posX") != null ? Double.parseDouble(cMap.get("posX").toString()) : 100.0);
                    clase.setPosY(cMap.get("posY") != null ? Double.parseDouble(cMap.get("posY").toString()) : 100.0);

                    // Métodos de la clase
                    if (cMap.get("metodos") instanceof List<?> metList) {
                        List<Map<String, Object>> mList = new ArrayList<>();
                        int mOrd = 0;
                        for (Object mObj : metList) {
                            if (mObj instanceof Map<?, ?> mMap) {
                                Map<String, Object> cleanMap = new HashMap<>();
                                cleanMap.put("id", mMap.get("id") != null ? mMap.get("id").toString() : "met-" + System.currentTimeMillis() + "-" + (mOrd++));
                                cleanMap.put("nombre", mMap.get("nombre") != null ? mMap.get("nombre").toString() : "metodo");
                                cleanMap.put("tipoRetorno", mMap.get("tipoRetorno") != null ? mMap.get("tipoRetorno").toString() : (mMap.get("tipo") != null ? mMap.get("tipo").toString() : "void"));
                                cleanMap.put("visibilidad", mMap.get("visibilidad") != null ? mMap.get("visibilidad").toString() : "public");
                                cleanMap.put("orden", mMap.get("orden") != null ? Integer.parseInt(mMap.get("orden").toString()) : mOrd++);
                                mList.add(cleanMap);
                            }
                        }
                        clase.setMetodos(mList);
                    }

                    clase = claseRepository.save(clase);

                    if (clientId != null) {
                        clasesGuardadas.put(clientId, clase);
                    }
                    clasesGuardadas.put(String.valueOf(clase.getId()), clase);

                    // Atributos
                    if (cMap.get("atributos") instanceof List<?> attrList) {
                        Set<Long> sentAttrIds = new HashSet<>();
                        int orden = 0;
                        List<Atributo> existentes = atributoRepository.findByClaseId(clase.getId());

                        for (Object objAttr : attrList) {
                            if (objAttr instanceof Map<?, ?> aMap) {
                                Long attrId = null;
                                if (aMap.get("id") != null && !aMap.get("id").toString().startsWith("temp-")) {
                                    try {
                                        attrId = Long.parseLong(aMap.get("id").toString());
                                    } catch (Exception ignored) {}
                                }
                                String nombreAttr = aMap.get("nombre") != null ? aMap.get("nombre").toString() : "attr";

                                Atributo attr = null;
                                if (attrId != null) {
                                    attr = atributoRepository.findById(attrId).orElse(null);
                                }
                                if (attr == null) {
                                    attr = existentes.stream()
                                            .filter(a -> a.getNombre().equalsIgnoreCase(nombreAttr))
                                            .findFirst()
                                            .orElse(new Atributo());
                                }

                                attr.setClase(clase);
                                attr.setNombre(nombreAttr);
                                attr.setTipoDato(aMap.get("tipoDato") != null ? aMap.get("tipoDato").toString() : (aMap.get("tipo") != null ? aMap.get("tipo").toString() : "String"));
                                attr.setVisibilidad(aMap.get("visibilidad") != null ? aMap.get("visibilidad").toString() : "private");
                                attr.setEsPk(Boolean.TRUE.equals(aMap.get("esPk")));
                                attr.setOrden(orden++);
                                attr = atributoRepository.save(attr);
                                if (attr.getId() != null) {
                                    sentAttrIds.add(attr.getId());
                                }
                            }
                        }
                        // Limpiar atributos eliminados en el cliente para esta clase
                        for (Atributo a : existentes) {
                            if (!sentAttrIds.contains(a.getId())) {
                                atributoRepository.delete(a);
                            }
                        }
                    }
                }
            }
        }

        // Relaciones
        if (payload.get("relaciones") instanceof List<?> relList) {
            for (Object objRel : relList) {
                if (objRel instanceof Map<?, ?> rMap) {
                    String origKey = rMap.get("origenId") != null ? rMap.get("origenId").toString() : (rMap.get("claseOrigen") instanceof Map<?,?> mo ? mo.get("id").toString() : null);
                    String destKey = rMap.get("destinoId") != null ? rMap.get("destinoId").toString() : (rMap.get("claseDestino") instanceof Map<?,?> md ? md.get("id").toString() : null);

                    Clase cOrig = (origKey != null) ? clasesGuardadas.get(origKey) : null;
                    Clase cDest = (destKey != null) ? clasesGuardadas.get(destKey) : null;

                    if (cOrig == null && origKey != null) {
                        try { cOrig = claseRepository.findById(Long.parseLong(origKey)).orElse(null); } catch (Exception ignored) {}
                    }
                    if (cDest == null && destKey != null) {
                        try { cDest = claseRepository.findById(Long.parseLong(destKey)).orElse(null); } catch (Exception ignored) {}
                    }

                    if (cOrig != null && cDest != null) {
                        Long relId = null;
                        if (rMap.get("id") != null && !rMap.get("id").toString().startsWith("temp-")) {
                            try { relId = Long.parseLong(rMap.get("id").toString()); } catch (Exception ignored) {}
                        }
                        RelacionClase rel = (relId != null) ? relacionRepository.findById(relId).orElse(new RelacionClase()) : new RelacionClase();
                        rel.setDiagrama(diagrama);
                        rel.setClaseOrigen(cOrig);
                        rel.setClaseDestino(cDest);
                        rel.setTipoRelacion(rMap.get("tipoRelacion") != null ? rMap.get("tipoRelacion").toString() : (rMap.get("tipo") != null ? rMap.get("tipo").toString() : "ASOCIACION"));
                        rel.setNombre(rMap.get("nombre") != null ? rMap.get("nombre").toString() : "");
                        rel.setCardinalidadOrigen(rMap.get("cardinalidadOrigen") != null ? rMap.get("cardinalidadOrigen").toString() : "1");
                        rel.setCardinalidadDestino(rMap.get("cardinalidadDestino") != null ? rMap.get("cardinalidadDestino").toString() : "1");
                        relacionRepository.save(rel);
                    }
                }
            }
        }

        var clasesFinales = claseRepository.findByDiagramaId(diagrama.getId());
        var relacionesFinales = relacionRepository.findByDiagramaId(diagrama.getId());

        return ResponseEntity.ok(new DiagramaSnapshotDTO(
                diagrama.getId(), proyecto.getId(), diagrama.getNombre(), diagrama.getVersion(),
                diagrama.getZoomCanvas(), diagrama.getPanX(), diagrama.getPanY(),
                clasesFinales, relacionesFinales
        ));
    }
}
