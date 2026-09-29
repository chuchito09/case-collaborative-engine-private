package com.casecollaborative.engine.service;

import com.casecollaborative.engine.model.entity.*;
import com.casecollaborative.engine.repository.*;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

@Service
public class ImageDiagramImportService {

    private static final Logger log = LoggerFactory.getLogger(ImageDiagramImportService.class);

    @Value("${gemini.api-key:}")
    private String configuredApiKey;

    private final ProyectoRepository proyectoRepository;
    private final DiagramaUmlRepository diagramaRepository;
    private final ClaseRepository claseRepository;
    private final AtributoRepository atributoRepository;
    private final RelacionClaseRepository relacionRepository;
    private final SesionColaborativaRepository sesionRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public ImageDiagramImportService(ProyectoRepository proyectoRepository,
            DiagramaUmlRepository diagramaRepository,
            ClaseRepository claseRepository,
            AtributoRepository atributoRepository,
            RelacionClaseRepository relacionRepository,
            SesionColaborativaRepository sesionRepository,
            SimpMessagingTemplate messagingTemplate,
            ObjectMapper objectMapper) {
        this.proyectoRepository = proyectoRepository;
        this.diagramaRepository = diagramaRepository;
        this.claseRepository = claseRepository;
        this.atributoRepository = atributoRepository;
        this.relacionRepository = relacionRepository;
        this.sesionRepository = sesionRepository;
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AtributoParsed(
            String nombre,
            @JsonProperty("tipoDato") String tipoDato,
            String visibilidad,
            Boolean esPk) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MetodoParsed(
            String nombre,
            @JsonProperty("tipoRetorno") String tipoRetorno,
            String visibilidad) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ClaseParsed(
            String nombre,
            String estereotipo,
            Double posX,
            Double posY,
            List<AtributoParsed> atributos,
            List<MetodoParsed> metodos) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RelacionParsed(
            String origen,
            String destino,
            String tipo,
            @JsonProperty("cardinalidadOrigen") String cardinalidadOrigen,
            @JsonProperty("cardinalidadDestino") String cardinalidadDestino,
            String nombre) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DiagramaParsed(
            List<ClaseParsed> clases,
            List<RelacionParsed> relaciones) {
    }

    public record ImageImportResultDTO(
            boolean exitoso,
            int clasesImportadas,
            int atributosImportados,
            int relacionesImportadas,
            String mensaje,
            DiagramaParsed diagramaExtraido) {
    }

    @Transactional
    public ImageImportResultDTO importarDesdeImagen(Long proyectoId, byte[] imageBytes, String mimeType,
            String customApiKey) {
        Proyecto proyecto = proyectoRepository.findById(proyectoId)
                .orElseThrow(() -> new RuntimeException("Proyecto no encontrado con ID: " + proyectoId));

        String apiKey = resolveApiKey(customApiKey);
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalArgumentException(
                    "No se proporcionó una API Key de Gemini. Por favor ingresa tu API Key de Google Gemini en el modal de importación.");
        }

        DiagramaParsed parsedDiagram = llamarGeminiVision(imageBytes, mimeType, apiKey);

        if (parsedDiagram == null || parsedDiagram.clases() == null || parsedDiagram.clases().isEmpty()) {
            throw new RuntimeException(
                    "No se detectaron clases ni entidades UML en la imagen proporcionada. Asegúrate de que la foto esté enfocada y legible.");
        }

        // 1. Obtener o crear DiagramaUML
        DiagramaUml diagrama = diagramaRepository.findByProyectoId(proyectoId)
                .orElseGet(() -> {
                    DiagramaUml d = new DiagramaUml();
                    d.setProyecto(proyecto);
                    d.setNombre("Diagrama " + proyecto.getNombre());
                    d.setVersion(1);
                    return diagramaRepository.save(d);
                });

        // 2. Limpiar elementos existentes previos para reemplazar con la nueva
        // topología
        List<RelacionClase> relsPrevias = relacionRepository.findByDiagramaId(diagrama.getId());
        relacionRepository.deleteAll(relsPrevias);

        List<Clase> clasesPrevias = claseRepository.findByDiagramaId(diagrama.getId());
        for (Clase c : clasesPrevias) {
            atributoRepository.deleteAll(atributoRepository.findByClaseId(c.getId()));
        }
        claseRepository.deleteAll(clasesPrevias);

        // 3. Crear Clases, Atributos y Métodos extraídos
        Map<String, Clase> nombreToClaseMap = new HashMap<>();
        int totalAtributos = 0;
        int index = 0;

        for (ClaseParsed cp : parsedDiagram.clases()) {
            if (cp.nombre() == null || cp.nombre().isBlank())
                continue;

            String nombreClase = normalizarNombreClase(cp.nombre());
            Double posX = (cp.posX() != null && cp.posX() > 0) ? cp.posX() : (80.0 + (index % 3) * 260.0);
            Double posY = (cp.posY() != null && cp.posY() > 0) ? cp.posY() : (80.0 + (index / 3) * 200.0);
            String estereotipo = (cp.estereotipo() != null && !cp.estereotipo().isBlank())
                    ? cp.estereotipo().toUpperCase()
                    : "CLASS";

            Clase clase = new Clase();
            clase.setDiagrama(diagrama);
            clase.setNombre(nombreClase);
            clase.setEstereotipo(estereotipo);
            clase.setPosX(posX);
            clase.setPosY(posY);

            // Métodos
            if (cp.metodos() != null && !cp.metodos().isEmpty()) {
                List<Map<String, Object>> mList = new ArrayList<>();
                int mOrd = 0;
                for (MetodoParsed mp : cp.metodos()) {
                    if (mp.nombre() == null || mp.nombre().isBlank())
                        continue;
                    String mNombre = mp.nombre().replaceAll("[()\\s]", "").trim();
                    if (mNombre.isBlank())
                        continue;
                    Map<String, Object> mMap = new HashMap<>();
                    mMap.put("id", "met-" + System.currentTimeMillis() + "-" + (mOrd++));
                    mMap.put("nombre", mNombre);
                    mMap.put("tipoRetorno", normalizarTipoDato(mp.tipoRetorno()));
                    mMap.put("visibilidad", normalizarVisibilidad(mp.visibilidad()));
                    mMap.put("orden", mOrd++);
                    mList.add(mMap);
                }
                clase.setMetodos(mList);
            }

            clase = claseRepository.save(clase);
            nombreToClaseMap.put(nombreClase.toLowerCase(), clase);

            if (cp.atributos() != null) {
                int orden = 0;
                for (AtributoParsed ap : cp.atributos()) {
                    if (ap.nombre() == null || ap.nombre().isBlank())
                        continue;
                    Atributo attr = new Atributo();
                    attr.setClase(clase);
                    attr.setNombre(ap.nombre().trim());
                    attr.setTipoDato(normalizarTipoDato(ap.tipoDato()));
                    attr.setVisibilidad(normalizarVisibilidad(ap.visibilidad()));
                    attr.setEsPk(Boolean.TRUE.equals(ap.esPk()) || ap.nombre().equalsIgnoreCase("id"));
                    attr.setOrden(orden++);
                    atributoRepository.save(attr);
                    totalAtributos++;
                }
            }
            index++;
        }

        // 4. Crear Relaciones extraídas
        int totalRelaciones = 0;
        if (parsedDiagram.relaciones() != null) {
            for (RelacionParsed rp : parsedDiagram.relaciones()) {
                if (rp.origen() == null || rp.destino() == null)
                    continue;
                Clase origen = nombreToClaseMap.get(rp.origen().trim().toLowerCase());
                Clase destino = nombreToClaseMap.get(rp.destino().trim().toLowerCase());

                if (origen != null && destino != null && !origen.getId().equals(destino.getId())) {
                    RelacionClase rel = new RelacionClase();
                    rel.setDiagrama(diagrama);
                    rel.setClaseOrigen(origen);
                    rel.setClaseDestino(destino);
                    rel.setTipoRelacion(normalizarTipoRelacion(rp.tipo()));
                    rel.setCardinalidadOrigen(rp.cardinalidadOrigen() != null ? rp.cardinalidadOrigen() : "1");
                    rel.setCardinalidadDestino(rp.cardinalidadDestino() != null ? rp.cardinalidadDestino() : "1");
                    rel.setNombre(rp.nombre() != null ? rp.nombre() : "");
                    relacionRepository.save(rel);
                    totalRelaciones++;
                }
            }
        }

        diagrama.setVersion(diagrama.getVersion() + 1);
        diagramaRepository.save(diagrama);

        // 5. Notificar a salas colaborativas activas vía WebSocket
        sesionRepository.findByProyectoIdAndActivaTrue(proyectoId).ifPresent(sesion -> {
            Map<String, Object> payload = Map.of(
                    "eventType", "SNAPSHOT_RELOAD_REQUESTED",
                    "senderId", 0,
                    "senderName", "ImageVisionImporter",
                    "data", Map.of("proyectoId", proyectoId));
            messagingTemplate.convertAndSend("/topic/sala/" + sesion.getSessionToken(), payload);
        });

        return new ImageImportResultDTO(
                true,
                nombreToClaseMap.size(),
                totalAtributos,
                totalRelaciones,
                "Diagrama reconstruido con éxito a partir de la imagen (" + nombreToClaseMap.size() + " clases, "
                        + totalAtributos + " atributos, " + totalRelaciones + " relaciones).",
                parsedDiagram);
    }

    private DiagramaParsed llamarGeminiVision(byte[] imageBytes, String mimeType, String apiKey) {
        try {
            String base64Image = Base64.getEncoder().encodeToString(imageBytes);
            String effectiveMimeType = (mimeType != null && !mimeType.isBlank()) ? mimeType : "image/jpeg";

            String prompt = """
                    Analiza la imagen adjunta, la cual contiene un diagrama de clases UML o modelo de base de datos relacional (puede ser digital, captura de pantalla o un boceto/dibujo hecho a mano en papel o pizarra).
                    Extrae con máxima precisión todas las clases, atributos, métodos/operaciones y relaciones presentes en el diagrama.

                    Devuelve ÚNICAMENTE un objeto JSON con la siguiente estructura estricta:
                    {
                      "clases": [
                        {
                          "nombre": "NombreClasePascalCase",
                          "estereotipo": "CLASS" | "INTERFACE" | "ENUM",
                          "posX": 100,
                          "posY": 150,
                          "atributos": [
                            {
                              "nombre": "nombreAtributo",
                              "tipoDato": "Long" | "String" | "Integer" | "Double" | "Boolean" | "Date",
                              "visibilidad": "private" | "public" | "protected" | "package",
                              "esPk": true | false
                            }
                          ],
                          "metodos": [
                            {
                              "nombre": "nombreMetodoSinParentesis",
                              "tipoRetorno": "void" | "String" | "Integer" | "Double" | "Boolean" | "Date",
                              "visibilidad": "public" | "private" | "protected" | "package"
                            }
                          ]
                        }
                      ],
                      "relaciones": [
                        {
                          "origen": "NombreClaseOrigen",
                          "destino": "NombreClaseDestino",
                          "tipo": "ASOCIACION" | "ASOCIACION_DIRIGIDA" | "AGREGACION" | "COMPOSICION" | "GENERALIZACION" | "REALIZACION" | "DEPENDENCIA" | "CLASE_ASOCIACION",
                          "cardinalidadOrigen": "1" | "0..1" | "*" | "1..*" | "0..*",
                          "cardinalidadDestino": "1" | "0..1" | "*" | "1..*" | "0..*",
                          "nombre": "nombreRolOpcional"
                        }
                      ]
                    }

                    Reglas críticas:
                    1. Asigna posiciones posX y posY estimadas (en un lienzo de 1200x800) respetando la distribución espacial relativa de las clases en la foto.
                    2. Si un atributo se llama 'id' o tiene un icono de llave / PK o subrayado, marca esPk: true.
                    3. Si una clase (ej. DetalleVenta, Detalle_Devolucion) está unida mediante una línea punteada/segmentada (---) a una línea de asociación entre dos clases (ej. entre Venta y Producto, o entre Cliente y Devolucion):
                       - Asegúrate de incluir la clase en "clases" con sus atributos y métodos.
                       - Incluye siempre la relación continua base entre las dos clases principales (ej. Venta <-> Producto con tipo ASOCIACION).
                       - Agrega una relación con tipo: "CLASE_ASOCIACION" donde "origen" es la clase de asociación (ej. "DetalleVenta"), "destino" es una de las clases de la relación base (ej. "Producto"), y el campo "nombre" DEBE ser estrictamente las dos clases base separadas por dos puntos (ej. "Venta:Producto" o "Cliente:Devolucion").
                    4. Extrae TODOS los métodos/operaciones de cada clase si existen en su compartimento inferior (ej. crear(), eliminar()), quitando los paréntesis en el campo "nombre".
                    5. Si hay herencia (flecha con triángulo blanco apuntando al padre), el tipo es GENERALIZACION, donde origen es el hijo y destino es el padre.
                    6. Si hay rombo relleno (diamante negro), es COMPOSICION. Si es rombo blanco, es AGREGACION.
                    7. Devuelve solo el JSON válido sin bloques markdown ni texto adicional.
                    """;

            Map<String, Object> inlineData = Map.of(
                    "mime_type", effectiveMimeType,
                    "data", base64Image);

            Map<String, Object> userContent = Map.of(
                    "parts", List.of(
                            Map.of("text", prompt),
                            Map.of("inline_data", inlineData)));

            Map<String, Object> requestBody = Map.of(
                    "contents", List.of(userContent),
                    "generationConfig", Map.of(
                            "response_mime_type", "application/json",
                            "temperature", 0.1));

            String requestJson = objectMapper.writeValueAsString(requestBody);

            String[] modelsToTry = new String[] {
                    "gemini-3.8-flash",
                    "gemini-2.5-flash",
                    "gemini-2.0-flash",
                    "gemini-1.5-flash",
                    "gemini-2.5-pro",
                    "gemini-1.5-pro"
            };
            HttpResponse<String> response = null;
            HttpResponse<String> lastMeaningfulErrorResponse = null;
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(20))
                    .build();

            for (String modelName : modelsToTry) {
                String apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName
                        + ":generateContent?key=" + apiKey.trim();
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(apiUrl))
                        .timeout(Duration.ofSeconds(45))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(requestJson))
                        .build();

                // Reintentos automáticos para mitigar 503 (spikes de alta demanda temporal)
                int maxRetries = 2;
                for (int attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        response = client.send(request, HttpResponse.BodyHandlers.ofString());
                        if (response.statusCode() == 200) {
                            log.info("Gemini Vision response OK (200) con modelo: {} (intento {})", modelName, attempt);
                            break;
                        }

                        lastMeaningfulErrorResponse = response;
                        String body = response.body() != null ? response.body() : "";
                        log.warn("Modelo {} retornó HTTP {} en intento {}: {}", modelName, response.statusCode(),
                                attempt, body);

                        // Si es clave de API inválida, no reintentar
                        if (response.statusCode() == 400
                                && (body.contains("API_KEY_INVALID") || body.contains("API key not valid"))) {
                            break;
                        }

                        // Si es 503 o 429 (alta demanda temporal), esperar y reintentar
                        if ((response.statusCode() == 503 || response.statusCode() == 429) && attempt < maxRetries) {
                            log.info("Esperando 1.5s antes de reintentar debido a alta demanda ({}) con {}...",
                                    response.statusCode(), modelName);
                            Thread.sleep(1500L * attempt);
                            continue;
                        }

                        // Si es 404, pasar al siguiente modelo de la lista
                        if (response.statusCode() == 404) {
                            break;
                        }
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    } catch (Exception ex) {
                        log.warn("Excepción llamando a {} (intento {}): {}", modelName, attempt, ex.getMessage());
                        if (attempt < maxRetries) {
                            try {
                                Thread.sleep(1000L);
                            } catch (InterruptedException ignored) {
                            }
                        }
                    }
                }

                if (response != null && response.statusCode() == 200) {
                    break;
                }
            }

            if (response == null || response.statusCode() != 200) {
                HttpResponse<String> errResp = (lastMeaningfulErrorResponse != null) ? lastMeaningfulErrorResponse
                        : response;
                String body = errResp != null ? errResp.body() : "Sin respuesta del servidor de Google";
                int code = errResp != null ? errResp.statusCode() : 500;
                log.error("Error en respuesta de Gemini Vision API: HTTP {} - {}", code, body);
                if (code == 400 && body.contains("API_KEY_INVALID")) {
                    throw new IllegalArgumentException(
                            "La API Key de Gemini ingresada es inválida o expiró. Por favor verifica tu clave en Google AI Studio (https://aistudio.google.com).");
                }
                if (code == 403 || (code == 400 && body.contains("API key not valid"))) {
                    throw new IllegalArgumentException(
                            "La API Key de Google Gemini ingresada no es válida. Por favor ingresa una clave válida de Google AI Studio.");
                }
                if (code == 429 || code == 503) {
                    throw new IllegalArgumentException(
                            "Los servidores de Google Gemini están experimentando alta demanda momentánea (HTTP " + code
                                    + "). Por favor presiona 'Reintentar' en unos instantes.");
                }
                throw new RuntimeException("Error en el servicio Gemini Vision (HTTP " + code + "): " + body);
            }

            // Parsear respuesta de Gemini
            var rootNode = objectMapper.readTree(response.body());
            var candidates = rootNode.path("candidates");
            if (candidates.isEmpty()) {
                throw new RuntimeException(
                        "La IA de visión no pudo interpretar la imagen. Asegúrate de subir una foto nítida de un diagrama UML.");
            }

            var textNode = candidates.get(0).path("content").path("parts").get(0).path("text");
            String rawJsonText = textNode.asText().trim();

            if (rawJsonText.startsWith("```json")) {
                rawJsonText = rawJsonText.substring(7);
            }
            if (rawJsonText.startsWith("```")) {
                rawJsonText = rawJsonText.substring(3);
            }
            if (rawJsonText.endsWith("```")) {
                rawJsonText = rawJsonText.substring(0, rawJsonText.length() - 3);
            }
            rawJsonText = rawJsonText.trim();

            return objectMapper.readValue(rawJsonText, DiagramaParsed.class);

        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Excepción procesando imagen con Gemini: {}", e.getMessage(), e);
            throw new RuntimeException(e.getMessage(), e);
        }
    }

    private String resolveApiKey(String customApiKey) {
        if (customApiKey != null && !customApiKey.isBlank()) {
            return customApiKey.trim();
        }
        if (configuredApiKey != null && !configuredApiKey.isBlank()) {
            return configuredApiKey.trim();
        }
        String envKey = System.getenv("GEMINI_API_KEY");
        if (envKey != null && !envKey.isBlank()) {
            return envKey.trim();
        }
        String sysProp = System.getProperty("gemini.api.key");
        if (sysProp != null && !sysProp.isBlank()) {
            return sysProp.trim();
        }
        return System.getenv("GEMINI_API_KEY");
    }

    private String normalizarNombreClase(String raw) {
        if (raw == null || raw.isBlank())
            return "Clase";
        String clean = raw.replaceAll("[^A-Za-z0-9_]", "").trim();
        if (clean.isEmpty())
            return "Clase";
        return clean.substring(0, 1).toUpperCase() + clean.substring(1);
    }

    private String normalizarTipoDato(String raw) {
        if (raw == null || raw.isBlank())
            return "String";
        String t = raw.trim().toLowerCase();
        if (t.contains("int") || t.contains("entero") || t.contains("number") || t.contains("num"))
            return "Integer";
        if (t.contains("long") || t.contains("bigint") || t.contains("id"))
            return "Long";
        if (t.contains("double") || t.contains("float") || t.contains("decimal") || t.contains("precio")
                || t.contains("monto"))
            return "Double";
        if (t.contains("bool"))
            return "Boolean";
        if (t.contains("date") || t.contains("fecha") || t.contains("time"))
            return "Date";
        if (t.contains("byte") || t.contains("blob"))
            return "byte[]";
        return "String";
    }

    private String normalizarVisibilidad(String raw) {
        if (raw == null || raw.isBlank())
            return "private";
        String v = raw.trim().toLowerCase();
        if (v.equals("+") || v.contains("pub"))
            return "public";
        if (v.equals("#") || v.contains("prot"))
            return "protected";
        if (v.equals("~") || v.contains("pack"))
            return "package";
        return "private";
    }

    private String normalizarTipoRelacion(String raw) {
        if (raw == null || raw.isBlank())
            return "ASOCIACION";
        String r = raw.trim().toUpperCase();
        if (r.contains("COMPOSI"))
            return "COMPOSICION";
        if (r.contains("AGREGA"))
            return "AGREGACION";
        if (r.contains("GENERALI") || r.contains("HEREN") || r.contains("EXTEND"))
            return "GENERALIZACION";
        if (r.contains("REALIZA") || r.contains("IMPLEM"))
            return "REALIZACION";
        if (r.contains("DEPEN"))
            return "DEPENDENCIA";
        if (r.contains("CLASE_ASOCIACION") || r.contains("ASOCIACION_CLASE") || r.contains("ASSOCIATION_CLASS") || r.contains("INTERMEDIA"))
            return "CLASE_ASOCIACION";
        if (r.contains("DIRIG"))
            return "ASOCIACION_DIRIGIDA";
        return "ASOCIACION";
    }
}
