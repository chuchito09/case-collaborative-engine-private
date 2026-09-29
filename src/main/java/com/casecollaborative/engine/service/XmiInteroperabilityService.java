package com.casecollaborative.engine.service;

import com.casecollaborative.engine.model.entity.*;
import com.casecollaborative.engine.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.w3c.dom.*;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.*;

@Service
public class XmiInteroperabilityService {

    private final DiagramaUmlRepository diagramaRepository;
    private final ClaseRepository claseRepository;
    private final AtributoRepository atributoRepository;
    private final RelacionClaseRepository relacionRepository;
    private final ProyectoRepository proyectoRepository;

    public XmiInteroperabilityService(DiagramaUmlRepository diagramaRepository,
                                      ClaseRepository claseRepository,
                                      AtributoRepository atributoRepository,
                                      RelacionClaseRepository relacionRepository,
                                      ProyectoRepository proyectoRepository) {
        this.diagramaRepository = diagramaRepository;
        this.claseRepository = claseRepository;
        this.atributoRepository = atributoRepository;
        this.relacionRepository = relacionRepository;
        this.proyectoRepository = proyectoRepository;
    }

    private String toEaGuid(String prefix, String idKey) {
        UUID uuid = UUID.nameUUIDFromBytes(idKey.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return prefix + "_" + uuid.toString().replace("-", "_").toUpperCase();
    }

    private RelacionClase findBaseRelForAssocClass(RelacionClase r, List<RelacionClase> relaciones) {
        if (r == null || relaciones == null) return null;
        String nombre = r.getNombre();
        if (nombre != null && (nombre.contains(":") || nombre.contains("-"))) {
            String sep = nombre.contains(":") ? ":" : "-";
            String[] parts = nombre.split(sep);
            if (parts.length == 2) {
                String n1 = parts[0].trim().toLowerCase();
                String n2 = parts[1].trim().toLowerCase();
                for (RelacionClase rb : relaciones) {
                    if ("CLASE_ASOCIACION".equalsIgnoreCase(rb.getTipoRelacion())) continue;
                    String oName = rb.getClaseOrigen().getNombre().trim().toLowerCase();
                    String dName = rb.getClaseDestino().getNombre().trim().toLowerCase();
                    if ((oName.equals(n1) && dName.equals(n2)) || (oName.equals(n2) && dName.equals(n1))) {
                        return rb;
                    }
                }
            }
        }

        return relaciones.stream().filter(rb -> 
            !"CLASE_ASOCIACION".equalsIgnoreCase(rb.getTipoRelacion()) &&
            (rb.getClaseOrigen().getId().equals(r.getClaseDestino().getId()) || rb.getClaseDestino().getId().equals(r.getClaseDestino().getId()))
        ).findFirst().orElse(null);
    }

    @Transactional(readOnly = true)
    public byte[] exportarXmi(Long proyectoId) {
        DiagramaUml diagrama = diagramaRepository.findByProyectoId(proyectoId)
                .orElseThrow(() -> new RuntimeException("Diagrama no encontrado"));

        List<Clase> clases = claseRepository.findByDiagramaId(diagrama.getId());
        List<RelacionClase> relaciones = relacionRepository.findByDiagramaId(diagrama.getId());

        try {
            DocumentBuilderFactory docFactory = DocumentBuilderFactory.newInstance();
            DocumentBuilder docBuilder = docFactory.newDocumentBuilder();
            Document doc = docBuilder.newDocument();

            Element rootElement = doc.createElement("xmi:XMI");
            rootElement.setAttribute("xmi:version", "2.1");
            rootElement.setAttribute("xmlns:xmi", "http://schema.omg.org/spec/XMI/2.1");
            rootElement.setAttribute("xmlns:uml", "http://schema.omg.org/spec/UML/2.1");
            doc.appendChild(rootElement);

            Element docElement = doc.createElement("xmi:Documentation");
            docElement.setAttribute("exporter", "Enterprise Architect");
            docElement.setAttribute("exporterVersion", "6.5");
            rootElement.appendChild(docElement);

            Element modelElement = doc.createElement("uml:Model");
            modelElement.setAttribute("xmi:type", "uml:Model");
            modelElement.setAttribute("name", "EA_Model");
            modelElement.setAttribute("visibility", "public");
            rootElement.appendChild(modelElement);

            String pkgGuid = toEaGuid("EAPK", "PACKAGE_" + diagrama.getId() + "_" + diagrama.getNombre());
            Element packagedElement = doc.createElement("packagedElement");
            packagedElement.setAttribute("xmi:type", "uml:Package");
            packagedElement.setAttribute("xmi:id", pkgGuid);
            packagedElement.setAttribute("name", diagrama.getNombre());
            packagedElement.setAttribute("visibility", "public");
            modelElement.appendChild(packagedElement);

            for (Clase c : clases) {
                String cGuid = toEaGuid("EAID", "CLASS_" + c.getId());
                Element claseElement = doc.createElement("packagedElement");
                String stereo = c.getEstereotipo() != null ? c.getEstereotipo().toUpperCase() : "CLASS";
                String typeStr = "uml:Class";

                RelacionClase assocClassRel = relaciones.stream().filter(r ->
                    "CLASE_ASOCIACION".equalsIgnoreCase(r.getTipoRelacion()) &&
                    r.getClaseOrigen().getId().equals(c.getId())
                ).findFirst().orElse(null);

                if (assocClassRel != null) {
                    typeStr = "uml:AssociationClass";
                } else if ("INTERFACE".equals(stereo)) typeStr = "uml:Interface";
                else if ("ENUM".equals(stereo)) typeStr = "uml:Enumeration";
                else if ("DATATYPE".equals(stereo)) typeStr = "uml:DataType";
                else if ("PACKAGE".equals(stereo)) typeStr = "uml:Package";

                claseElement.setAttribute("xmi:type", typeStr);
                claseElement.setAttribute("xmi:id", cGuid);
                claseElement.setAttribute("name", c.getNombre());
                claseElement.setAttribute("visibility", c.getVisibilidad() != null ? c.getVisibilidad() : "public");
                packagedElement.appendChild(claseElement);

                List<Atributo> atributos = atributoRepository.findByClaseId(c.getId());
                for (Atributo a : atributos) {
                    String aGuid = toEaGuid("EAID", "ATTR_" + a.getId());
                    Element attrElement = doc.createElement("ownedAttribute");
                    attrElement.setAttribute("xmi:type", "uml:Property");
                    attrElement.setAttribute("xmi:id", aGuid);
                    attrElement.setAttribute("name", a.getNombre());
                    attrElement.setAttribute("visibility", a.getVisibilidad() != null ? a.getVisibilidad() : "private");
                    
                    Element typeEl = doc.createElement("type");
                    typeEl.setAttribute("xmi:type", "uml:PrimitiveType");
                    typeEl.setAttribute("href", "http://schema.omg.org/spec/UML/2.1/uml.xml#" + a.getTipoDato());
                    attrElement.appendChild(typeEl);

                    claseElement.appendChild(attrElement);
                }

                // Exportar métodos (operaciones)
                List<Map<String, Object>> metodos = c.getMetodos();
                if (metodos != null) {
                    int opIdx = 0;
                    for (Map<String, Object> m : metodos) {
                        String mNombre = (String) m.get("nombre");
                        if (mNombre == null || mNombre.isBlank()) continue;
                        String opGuid = toEaGuid("EAID", "OP_" + c.getId() + "_" + mNombre + "_" + (opIdx++));
                        Element opElement = doc.createElement("ownedOperation");
                        opElement.setAttribute("xmi:type", "uml:Operation");
                        opElement.setAttribute("xmi:id", opGuid);
                        opElement.setAttribute("name", mNombre);
                        opElement.setAttribute("visibility", m.get("visibilidad") != null ? (String) m.get("visibilidad") : "public");

                        String retType = m.get("tipoRetorno") != null ? (String) m.get("tipoRetorno") : "void";
                        if (!"void".equalsIgnoreCase(retType)) {
                            Element returnParam = doc.createElement("ownedParameter");
                            returnParam.setAttribute("xmi:type", "uml:Parameter");
                            returnParam.setAttribute("direction", "return");
                            Element retTypeEl = doc.createElement("type");
                            retTypeEl.setAttribute("xmi:type", "uml:PrimitiveType");
                            retTypeEl.setAttribute("href", "http://schema.omg.org/spec/UML/2.1/uml.xml#" + retType);
                            returnParam.appendChild(retTypeEl);
                            opElement.appendChild(returnParam);
                        }
                        claseElement.appendChild(opElement);
                    }
                }
            }

            for (RelacionClase r : relaciones) {
                if ("CLASE_ASOCIACION".equalsIgnoreCase(r.getTipoRelacion())) {
                    continue; // En UML y EA, la clase de asociación ya se define en uml:AssociationClass y en el conector base
                }

                String srcGuid = toEaGuid("EAID", "CLASS_" + r.getClaseOrigen().getId());
                String dstGuid = toEaGuid("EAID", "CLASS_" + r.getClaseDestino().getId());
                String relGuid = toEaGuid("EAID", "REL_" + r.getId());

                if ("GENERALIZACION".equalsIgnoreCase(r.getTipoRelacion())) {
                    NodeList nodes = packagedElement.getChildNodes();
                    for (int i = 0; i < nodes.getLength(); i++) {
                        Node node = nodes.item(i);
                        if (node.getNodeType() == Node.ELEMENT_NODE) {
                            Element el = (Element) node;
                            if (el.getAttribute("xmi:id").equals(srcGuid)) {
                                Element genElement = doc.createElement("generalization");
                                genElement.setAttribute("xmi:type", "uml:Generalization");
                                genElement.setAttribute("xmi:id", relGuid);
                                genElement.setAttribute("general", dstGuid);
                                el.appendChild(genElement);
                                break;
                            }
                        }
                    }
                } else if ("REALIZACION".equalsIgnoreCase(r.getTipoRelacion())) {
                    Element realElement = doc.createElement("packagedElement");
                    realElement.setAttribute("xmi:type", "uml:Realization");
                    realElement.setAttribute("xmi:id", relGuid);
                    realElement.setAttribute("client", srcGuid);
                    realElement.setAttribute("supplier", dstGuid);
                    packagedElement.appendChild(realElement);
                } else if ("DEPENDENCIA".equalsIgnoreCase(r.getTipoRelacion())) {
                    Element depElement = doc.createElement("packagedElement");
                    depElement.setAttribute("xmi:type", "uml:Dependency");
                    depElement.setAttribute("xmi:id", relGuid);
                    depElement.setAttribute("client", srcGuid);
                    depElement.setAttribute("supplier", dstGuid);
                    packagedElement.appendChild(depElement);
                } else {
                    Element assocElement = doc.createElement("packagedElement");
                    assocElement.setAttribute("xmi:type", "uml:Association");
                    assocElement.setAttribute("xmi:id", relGuid);
                    if (r.getNombre() != null && !r.getNombre().isEmpty()) {
                        assocElement.setAttribute("name", r.getNombre());
                    }

                    String end1Id = toEaGuid("EAID", "SRC_PROP_" + r.getId());
                    String end2Id = toEaGuid("EAID", "DST_PROP_" + r.getId());
                    assocElement.setAttribute("memberEnd", end1Id + " " + end2Id);

                    Element end1 = doc.createElement("ownedEnd");
                    end1.setAttribute("xmi:type", "uml:Property");
                    end1.setAttribute("xmi:id", end1Id);
                    end1.setAttribute("type", srcGuid);
                    end1.setAttribute("association", relGuid);
                    if (r.getCardinalidadOrigen() != null && !r.getCardinalidadOrigen().isBlank()) {
                        Element lower1 = doc.createElement("lowerValue");
                        lower1.setAttribute("xmi:type", "uml:LiteralString");
                        lower1.setAttribute("value", r.getCardinalidadOrigen());
                        end1.appendChild(lower1);
                    }
                    assocElement.appendChild(end1);

                    Element end2 = doc.createElement("ownedEnd");
                    end2.setAttribute("xmi:type", "uml:Property");
                    end2.setAttribute("xmi:id", end2Id);
                    end2.setAttribute("type", dstGuid);
                    end2.setAttribute("association", relGuid);
                    if ("COMPOSICION".equalsIgnoreCase(r.getTipoRelacion())) {
                        end2.setAttribute("aggregation", "composite");
                    } else if ("AGREGACION".equalsIgnoreCase(r.getTipoRelacion())) {
                        end2.setAttribute("aggregation", "shared");
                    }
                    if (r.getCardinalidadDestino() != null && !r.getCardinalidadDestino().isBlank()) {
                        Element lower2 = doc.createElement("lowerValue");
                        lower2.setAttribute("xmi:type", "uml:LiteralString");
                        lower2.setAttribute("value", r.getCardinalidadDestino());
                        end2.appendChild(lower2);
                    }
                    assocElement.appendChild(end2);

                    packagedElement.appendChild(assocElement);
                }
            }

            // Extensión de Enterprise Architect
            Element eaExtension = doc.createElement("xmi:Extension");
            eaExtension.setAttribute("extender", "Enterprise Architect");
            eaExtension.setAttribute("extenderID", "6.5");

            // Elementos del modelo en EA
            Element elementsElem = doc.createElement("elements");
            Element pkgElem = doc.createElement("element");
            pkgElem.setAttribute("xmi:idref", pkgGuid);
            pkgElem.setAttribute("xmi:type", "uml:Package");
            pkgElem.setAttribute("name", diagrama.getNombre());
            pkgElem.setAttribute("scope", "public");

            Element pkgModel = doc.createElement("model");
            pkgModel.setAttribute("package2", pkgGuid);
            pkgModel.setAttribute("package", pkgGuid);
            pkgModel.setAttribute("tpos", "0");
            pkgModel.setAttribute("ea_eleType", "package");
            pkgElem.appendChild(pkgModel);

            Element pkgProps = doc.createElement("properties");
            pkgProps.setAttribute("name", diagrama.getNombre());
            pkgProps.setAttribute("type", "Package");
            pkgProps.setAttribute("sType", "Package");
            pkgProps.setAttribute("scope", "public");
            pkgElem.appendChild(pkgProps);
            elementsElem.appendChild(pkgElem);

            for (Clase c : clases) {
                String cGuid = toEaGuid("EAID", "CLASS_" + c.getId());
                Element cElem = doc.createElement("element");
                cElem.setAttribute("xmi:idref", cGuid);
                cElem.setAttribute("xmi:type", "uml:Class");
                cElem.setAttribute("name", c.getNombre());
                cElem.setAttribute("scope", c.getVisibilidad() != null ? c.getVisibilidad() : "public");

                Element cModel = doc.createElement("model");
                cModel.setAttribute("package", pkgGuid);
                cModel.setAttribute("tpos", "0");
                cModel.setAttribute("ea_eleType", "element");
                cElem.appendChild(cModel);

                RelacionClase assocClassRel = relaciones.stream().filter(r ->
                    "CLASE_ASOCIACION".equalsIgnoreCase(r.getTipoRelacion()) &&
                    r.getClaseOrigen().getId().equals(c.getId())
                ).findFirst().orElse(null);

                RelacionClase baseRelForThisClass = null;
                if (assocClassRel != null) {
                    baseRelForThisClass = findBaseRelForAssocClass(assocClassRel, relaciones);
                }

                Element cProps = doc.createElement("properties");
                cProps.setAttribute("name", c.getNombre());
                cProps.setAttribute("type", "Class");
                cProps.setAttribute("sType", "Class");
                if (baseRelForThisClass != null) {
                    cProps.setAttribute("nType", "17");
                }
                cProps.setAttribute("scope", c.getVisibilidad() != null ? c.getVisibilidad() : "public");
                cElem.appendChild(cProps);

                Element extProps = doc.createElement("extendedProperties");
                if (baseRelForThisClass != null) {
                    String baseConnGuid = toEaGuid("EAID", "REL_" + baseRelForThisClass.getId());
                    extProps.setAttribute("conID", baseConnGuid);
                    extProps.setAttribute("associationconnector", baseConnGuid);
                } else {
                    extProps.setAttribute("tagged", "0");
                }
                cElem.appendChild(extProps);

                elementsElem.appendChild(cElem);
            }
            eaExtension.appendChild(elementsElem);

            Element connectorsElem = doc.createElement("connectors");
            for (RelacionClase r : relaciones) {
                if ("CLASE_ASOCIACION".equalsIgnoreCase(r.getTipoRelacion())) {
                    continue; // En EA las clases asociación se vinculan directamente a través del conector base con subtype="Class" y associationclass
                }

                Element conn = doc.createElement("connector");
                String rType = r.getTipoRelacion();
                String relGuid = toEaGuid("EAID", "REL_" + r.getId());
                conn.setAttribute("xmi:idref", relGuid);

                Element srcConn = doc.createElement("source");
                srcConn.setAttribute("xmi:idref", toEaGuid("EAID", "CLASS_" + r.getClaseOrigen().getId()));
                Element srcMult = doc.createElement("type");
                srcMult.setAttribute("multiplicity", r.getCardinalidadOrigen() != null ? r.getCardinalidadOrigen() : "");
                srcConn.appendChild(srcMult);
                conn.appendChild(srcConn);

                Element dstConn = doc.createElement("target");
                dstConn.setAttribute("xmi:idref", toEaGuid("EAID", "CLASS_" + r.getClaseDestino().getId()));

                Element dstMult = doc.createElement("type");
                dstMult.setAttribute("multiplicity", r.getCardinalidadDestino() != null ? r.getCardinalidadDestino() : "");
                if ("COMPOSICION".equalsIgnoreCase(rType)) {
                    dstMult.setAttribute("aggregation", "composite");
                } else if ("AGREGACION".equalsIgnoreCase(rType)) {
                    dstMult.setAttribute("aggregation", "shared");
                }
                dstConn.appendChild(dstMult);
                conn.appendChild(dstConn);

                Element propConn = doc.createElement("properties");
                String eaTypeStr = "Association";
                String subtypeStr = "";
                String directionStr = "Unspecified";

                // Verificar si esta relación tiene una Clase de Asociación vinculada
                RelacionClase assocClassForThisBase = relaciones.stream().filter(ra ->
                    "CLASE_ASOCIACION".equalsIgnoreCase(ra.getTipoRelacion()) &&
                    r.equals(findBaseRelForAssocClass(ra, relaciones))
                ).findFirst().orElse(null);

                if ("GENERALIZACION".equalsIgnoreCase(rType)) {
                    eaTypeStr = "Generalization";
                    directionStr = "Source -> Destination";
                } else if ("REALIZACION".equalsIgnoreCase(rType)) {
                    eaTypeStr = "Realisation";
                    directionStr = "Source -> Destination";
                } else if ("DEPENDENCIA".equalsIgnoreCase(rType)) {
                    eaTypeStr = "Dependency";
                    directionStr = "Source -> Destination";
                } else if ("AGREGACION".equalsIgnoreCase(rType)) {
                    eaTypeStr = "Aggregation";
                    subtypeStr = "Shared";
                } else if ("COMPOSICION".equalsIgnoreCase(rType)) {
                    eaTypeStr = "Composition";
                    subtypeStr = "Composite";
                } else if (assocClassForThisBase != null) {
                    eaTypeStr = "Association";
                    subtypeStr = "Class";
                    directionStr = "Unspecified";
                }

                propConn.setAttribute("ea_type", eaTypeStr);
                propConn.setAttribute("direction", directionStr);
                if (!subtypeStr.isEmpty()) propConn.setAttribute("subtype", subtypeStr);
                if (r.getNombre() != null && !r.getNombre().isBlank()) {
                    propConn.setAttribute("name", r.getNombre());
                }
                conn.appendChild(propConn);

                if (assocClassForThisBase != null) {
                    String assocClassGuid = toEaGuid("EAID", "CLASS_" + assocClassForThisBase.getClaseOrigen().getId());
                    Element extProps = doc.createElement("extendedProperties");
                    extProps.setAttribute("associationclass", assocClassGuid);
                    conn.appendChild(extProps);
                }

                connectorsElem.appendChild(conn);
            }
            eaExtension.appendChild(connectorsElem);

            Element diagramsElem = doc.createElement("diagrams");
            Element diagElem = doc.createElement("diagram");
            diagElem.setAttribute("xmi:id", toEaGuid("EAID", "DIAG_" + diagrama.getId()));

            Element modelDiag = doc.createElement("model");
            modelDiag.setAttribute("package", pkgGuid);
            modelDiag.setAttribute("localID", "1");
            modelDiag.setAttribute("type", "Logical");
            modelDiag.setAttribute("name", diagrama.getNombre());
            diagElem.appendChild(modelDiag);

            Element diagProps = doc.createElement("properties");
            diagProps.setAttribute("name", diagrama.getNombre());
            diagProps.setAttribute("type", "Logical");
            diagElem.appendChild(diagProps);

            Element diagElements = doc.createElement("elements");
            int seqNo = 1;
            for (Clase c : clases) {
                String cGuid = toEaGuid("EAID", "CLASS_" + c.getId());
                Element dObj = doc.createElement("element");
                dObj.setAttribute("subject", cGuid);
                dObj.setAttribute("xmi:idref", cGuid);
                dObj.setAttribute("seqno", String.valueOf(seqNo++));
                int left = (int) Math.round(c.getPosX());
                int top = (int) Math.round(c.getPosY());
                int right = left + 200;
                int bottom = top + 130;
                dObj.setAttribute("geometry", "Left=" + left + ";Top=" + top + ";Right=" + right + ";Bottom=" + bottom + ";");
                diagElements.appendChild(dObj);
            }
            diagElem.appendChild(diagElements);

            Element diagLinks = doc.createElement("links");
            for (RelacionClase r : relaciones) {
                if ("CLASE_ASOCIACION".equalsIgnoreCase(r.getTipoRelacion())) continue;
                Element dLink = doc.createElement("link");
                String eaConnId = toEaGuid("EAID", "REL_" + r.getId());
                dLink.setAttribute("xmi:idref", eaConnId);
                diagLinks.appendChild(dLink);
            }
            diagElem.appendChild(diagLinks);

            diagramsElem.appendChild(diagElem);
            eaExtension.appendChild(diagramsElem);

            rootElement.appendChild(eaExtension);

            TransformerFactory transformerFactory = TransformerFactory.newInstance();
            Transformer transformer = transformerFactory.newTransformer();
            transformer.setOutputProperty(OutputKeys.INDENT, "yes");
            DOMSource source = new DOMSource(doc);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            StreamResult result = new StreamResult(bos);

            transformer.transform(source, result);
            return bos.toByteArray();

        } catch (Exception e) {
            throw new RuntimeException("Error al exportar XMI", e);
        }
    }

    @Transactional
    public void importarXmi(Long proyectoId, InputStream xmiInputStream) {
        Proyecto proyecto = proyectoRepository.findById(proyectoId)
                .orElseThrow(() -> new RuntimeException("Proyecto no encontrado"));

        DiagramaUml diagrama = diagramaRepository.findByProyectoId(proyectoId)
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

        // Limpiar elementos existentes del diagrama
        List<RelacionClase> relsAnteriores = relacionRepository.findByDiagramaId(diagrama.getId());
        relacionRepository.deleteAll(relsAnteriores);

        List<Clase> clasesAnteriores = claseRepository.findByDiagramaId(diagrama.getId());
        for (Clase c : clasesAnteriores) {
            atributoRepository.deleteAll(atributoRepository.findByClaseId(c.getId()));
        }
        claseRepository.deleteAll(clasesAnteriores);

        try {
            DocumentBuilderFactory dbFactory = DocumentBuilderFactory.newInstance();
            dbFactory.setNamespaceAware(false);
            DocumentBuilder dBuilder = dbFactory.newDocumentBuilder();
            Document doc = dBuilder.parse(xmiInputStream);
            doc.getDocumentElement().normalize();

            Map<String, Clase> xmiIdToClaseMap = new HashMap<>();
            Map<String, String> propertyToClassMap = new HashMap<>();
            Map<String, String> propertyToTargetTypeMap = new HashMap<>();
            Map<String, String> classToAssocConnectorMap = new HashMap<>();
            Set<String> relacionesCreadasKeys = new HashSet<>();

            // 0. PASO PREVIO: Parsear elementos y coordenadas específicas del Diagrama si existen en el XMI de EA
            Map<String, double[]> diagramElementPosMap = new LinkedHashMap<>();
            NodeList diagList = doc.getElementsByTagName("diagram");
            for (int d = 0; d < diagList.getLength(); d++) {
                Node diagNode = diagList.item(d);
                if (diagNode.getNodeType() == Node.ELEMENT_NODE) {
                    Element diagEl = (Element) diagNode;
                    NodeList diagElements = diagEl.getElementsByTagName("element");
                    for (int de = 0; de < diagElements.getLength(); de++) {
                        Node deNode = diagElements.item(de);
                        if (deNode.getNodeType() == Node.ELEMENT_NODE) {
                            Element dEl = (Element) deNode;
                            String subj = getAttributeValue(dEl, "subject", "xmi:idref", "idref");
                            String geom = dEl.getAttribute("geometry");
                            // Filtrar conectores que aparecen en el diagrama con geometría EDGE=... o SX=...
                            if (subj != null && !subj.isEmpty() && geom != null && !geom.startsWith("EDGE=") && !geom.startsWith("SX=")) {
                                double left = 100;
                                double top = 100;
                                for (String part : geom.split(";")) {
                                    String[] kv = part.split("=");
                                    if (kv.length == 2) {
                                        String k = kv[0].trim().toLowerCase();
                                        String v = kv[1].trim();
                                        try {
                                            if (k.equals("left")) left = Math.abs(Double.parseDouble(v));
                                            if (k.equals("top")) top = Math.abs(Double.parseDouble(v));
                                        } catch (NumberFormatException ignored) {}
                                    }
                                }
                                diagramElementPosMap.put(subj, new double[]{left, top});
                            }
                        }
                    }
                }
            }

            // Layout en cuadrícula fallback si no hay coordenadas en el diagrama
            double startX = 80.0;
            double startY = 80.0;
            double colSpacing = 240.0;
            double rowSpacing = 180.0;
            int cols = 4;
            int classIndex = 0;

            // 1. PRIMER PASO: Buscar y crear clases, interfaces, enums del modelo real (incluyendo subpaquetes)
            NodeList allElements = doc.getElementsByTagName("*");
            for (int i = 0; i < allElements.getLength(); i++) {
                Node node = allElements.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE) {
                    Element el = (Element) node;
                    String tagName = el.getTagName();
                    String xmiType = getAttributeValue(el, "xmi:type", "type");
                    String xmiId = getAttributeValue(el, "xmi:id", "id");

                    boolean isPackage = "uml:Package".equalsIgnoreCase(xmiType) || 
                                        "Package".equalsIgnoreCase(xmiType) || 
                                        "package".equalsIgnoreCase(tagName);

                    // Descartar paquetes
                    if (isPackage) {
                        continue;
                    }

                    boolean isClassElement = "packagedElement".equalsIgnoreCase(tagName) || "element".equalsIgnoreCase(tagName);
                    boolean isClassType = "uml:Class".equalsIgnoreCase(xmiType) ||
                                          "uml:Interface".equalsIgnoreCase(xmiType) ||
                                          "uml:Enumeration".equalsIgnoreCase(xmiType) ||
                                          "uml:DataType".equalsIgnoreCase(xmiType) ||
                                          "uml:AssociationClass".equalsIgnoreCase(xmiType) ||
                                          "AssociationClass".equalsIgnoreCase(xmiType) ||
                                          "Class".equalsIgnoreCase(xmiType) ||
                                          "Interface".equalsIgnoreCase(xmiType);

                    if (isClassElement && isClassType && xmiId != null && !xmiId.isEmpty()) {
                        if (xmiIdToClaseMap.containsKey(xmiId)) {
                            // Extraer conID de extendedProperties si está disponible en la definición de element
                            String extConId = getChildElementValue(el, "extendedProperties", "conID");
                            if (extConId == null || extConId.isBlank()) {
                                extConId = getChildElementValue(el, "extendedProperties", "associationconnector");
                            }
                            if (extConId != null && !extConId.isBlank()) {
                                classToAssocConnectorMap.put(xmiId, extConId);
                            }
                            continue;
                        }

                        String name = el.getAttribute("name");
                        if (name == null || name.trim().isEmpty()) {
                            name = getChildElementValue(el, "properties", "name");
                        }

                        // Ignorar catálogos internos de tipos de Enterprise Architect y nombres de paquetes
                        String nameLower = (name != null) ? name.toLowerCase() : "";
                        if (nameLower.startsWith("ea_") ||
                            nameLower.contains("primitivetypes") ||
                            nameLower.contains("types_package") ||
                            nameLower.contains("type_package") ||
                            nameLower.equals("earootclass")) {
                            continue;
                        }

                        // Si el XMI contiene diagrama de EA, verificar si está en el diagrama o incluirla
                        if (!diagramElementPosMap.isEmpty() && !diagramElementPosMap.containsKey(xmiId)) {
                            // Si la clase no está en el diagrama visual de EA, la registramos igual con posición calculada para no perder relaciones
                        }

                        if (name == null || name.trim().isEmpty()) {
                            name = "Clase_" + (classIndex + 1);
                        }

                        String stereo = "CLASS";
                        if (xmiType != null && xmiType.toLowerCase().contains("interface")) stereo = "INTERFACE";
                        else if (xmiType != null && xmiType.toLowerCase().contains("enum")) stereo = "ENUM";
                        else if (xmiType != null && xmiType.toLowerCase().contains("datatype")) stereo = "DATATYPE";

                        String visibility = el.getAttribute("visibility");
                        if (visibility == null || visibility.isEmpty()) visibility = "public";

                        // Asignar posición: del diagrama de EA o calculada en cuadrícula
                        double posX;
                        double posY;
                        if (diagramElementPosMap.containsKey(xmiId)) {
                            double[] coords = diagramElementPosMap.get(xmiId);
                            posX = Math.max(40.0, coords[0]);
                            posY = Math.max(40.0, coords[1]);
                        } else {
                            int row = classIndex / cols;
                            int col = classIndex % cols;
                            posX = startX + (col * colSpacing);
                            posY = startY + (row * rowSpacing);
                        }

                        Clase clase = new Clase();
                        clase.setDiagrama(diagrama);
                        clase.setNombre(name);
                        clase.setEstereotipo(stereo);
                        clase.setVisibilidad(visibility);
                        clase.setPosX(posX);
                        clase.setPosY(posY);
                        clase = claseRepository.save(clase);

                        xmiIdToClaseMap.put(xmiId, clase);
                        classIndex++;

                        // Verificar si tiene conID / associationconnector en extendedProperties
                        String extConId = getChildElementValue(el, "extendedProperties", "conID");
                        if (extConId == null || extConId.isBlank()) {
                            extConId = getChildElementValue(el, "extendedProperties", "associationconnector");
                        }
                        if (extConId != null && !extConId.isBlank()) {
                            classToAssocConnectorMap.put(xmiId, extConId);
                        }

                        // Parsear Atributos y Operaciones (Métodos) dentro de la clase
                        NodeList childNodes = el.getChildNodes();
                        int attrOrder = 0;
                        int metOrder = 0;
                        List<Map<String, Object>> metodosList = new ArrayList<>();

                        for (int j = 0; j < childNodes.getLength(); j++) {
                            Node child = childNodes.item(j);
                            if (child.getNodeType() == Node.ELEMENT_NODE) {
                                Element childEl = (Element) child;
                                String childTag = childEl.getTagName();
                                String propType = getAttributeValue(childEl, "xmi:type", "type");
                                String propId = getAttributeValue(childEl, "xmi:id", "id");

                                if ("ownedAttribute".equalsIgnoreCase(childTag) || "attribute".equalsIgnoreCase(childTag) || "uml:Property".equalsIgnoreCase(propType)) {
                                    String attrName = childEl.getAttribute("name");
                                    String targetRef = null;
                                    NodeList typeNodes = childEl.getElementsByTagName("type");
                                    if (typeNodes.getLength() > 0) {
                                        Element typeNode = (Element) typeNodes.item(0);
                                        targetRef = getAttributeValue(typeNode, "xmi:idref", "idref");
                                    }
                                    if (propId != null) {
                                        propertyToClassMap.put(propId, xmiId);
                                        if (targetRef != null) propertyToTargetTypeMap.put(propId, targetRef);
                                    }

                                    // Si es un atributo con nombre real
                                    if (attrName != null && !attrName.trim().isEmpty()) {
                                        String tipoDato = parseDataType(childEl);
                                        String attrVis = childEl.getAttribute("visibility");
                                        if (attrVis == null || attrVis.isEmpty()) attrVis = "private";

                                        boolean isPk = attrName.equalsIgnoreCase("id") || attrName.toLowerCase().endsWith("_id");

                                        Atributo attr = new Atributo();
                                        attr.setClase(clase);
                                        attr.setNombre(attrName);
                                        attr.setTipoDato(tipoDato);
                                        attr.setVisibilidad(attrVis);
                                        attr.setEsPk(isPk);
                                        attr.setOrden(attrOrder++);
                                        atributoRepository.save(attr);
                                    }
                                } else if ("ownedOperation".equalsIgnoreCase(childTag) || "operation".equalsIgnoreCase(childTag)) {
                                    String opName = childEl.getAttribute("name");
                                    if (opName != null && !opName.isBlank()) {
                                        String opVis = childEl.getAttribute("visibility");
                                        if (opVis == null || opVis.isBlank()) opVis = "public";
                                        String returnType = "void";
                                        NodeList params = childEl.getElementsByTagName("ownedParameter");
                                        for (int p = 0; p < params.getLength(); p++) {
                                            Element paramEl = (Element) params.item(p);
                                            if ("return".equalsIgnoreCase(paramEl.getAttribute("direction"))) {
                                                returnType = parseDataType(paramEl);
                                            }
                                        }
                                        Map<String, Object> mMap = new HashMap<>();
                                        mMap.put("id", "met-" + System.currentTimeMillis() + "-" + (metOrder++));
                                        mMap.put("nombre", opName.replaceAll("[()\\s]", "").trim());
                                        mMap.put("tipoRetorno", returnType);
                                        mMap.put("visibilidad", opVis);
                                        mMap.put("orden", metOrder);
                                        metodosList.add(mMap);
                                    }
                                }
                            }
                        }

                        if (!metodosList.isEmpty()) {
                            clase.setMetodos(metodosList);
                            claseRepository.save(clase);
                        }
                    }
                }
            }

            // 2. SEGUNDO PASO: Parsear Generalizaciones (Herencias)
            NodeList genNodes = doc.getElementsByTagName("generalization");
            for (int i = 0; i < genNodes.getLength(); i++) {
                Node node = genNodes.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE) {
                    Element genEl = (Element) node;
                    String targetId = getAttributeValue(genEl, "general", "target");
                    if (targetId == null && genEl.getElementsByTagName("general").getLength() > 0) {
                        Element gEl = (Element) genEl.getElementsByTagName("general").item(0);
                        targetId = getAttributeValue(gEl, "xmi:idref", "idref");
                    }

                    Node parentNode = genEl.getParentNode();
                    String sourceId = null;
                    if (parentNode != null && parentNode.getNodeType() == Node.ELEMENT_NODE) {
                        sourceId = getAttributeValue((Element) parentNode, "xmi:id", "id");
                    }

                    if (sourceId != null && targetId != null) {
                        Clase cOrig = xmiIdToClaseMap.get(sourceId);
                        Clase cDest = xmiIdToClaseMap.get(targetId);
                        if (cOrig != null && cDest != null) {
                            crearRelacionSiNoExiste(diagrama, cOrig, cDest, "GENERALIZACION", "", "1", "1", relacionesCreadasKeys);
                        }
                    }
                }
            }

            // 3. TERCER PASO: Parsear Realizaciones, Dependencias y Usos
            for (int i = 0; i < allElements.getLength(); i++) {
                Node node = allElements.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE) {
                    Element el = (Element) node;
                    String xmiType = getAttributeValue(el, "xmi:type", "type");
                    String tag = el.getTagName();

                    boolean isRealization = "uml:Realization".equalsIgnoreCase(xmiType) || "realization".equalsIgnoreCase(tag) || "interfaceRealization".equalsIgnoreCase(tag);
                    boolean isDependency = "uml:Dependency".equalsIgnoreCase(xmiType) || "uml:Usage".equalsIgnoreCase(xmiType) || "dependency".equalsIgnoreCase(tag);

                    if (isRealization || isDependency) {
                        String clientId = getAttributeValue(el, "client", "source");
                        String supplierId = getAttributeValue(el, "supplier", "target");

                        if (clientId == null && el.getElementsByTagName("client").getLength() > 0) {
                            clientId = getAttributeValue((Element) el.getElementsByTagName("client").item(0), "xmi:idref", "idref");
                        }
                        if (supplierId == null && el.getElementsByTagName("supplier").getLength() > 0) {
                            supplierId = getAttributeValue((Element) el.getElementsByTagName("supplier").item(0), "xmi:idref", "idref");
                        }

                        if (clientId != null && supplierId != null) {
                            Clase cOrig = xmiIdToClaseMap.get(clientId);
                            Clase cDest = xmiIdToClaseMap.get(supplierId);
                            if (cOrig != null && cDest != null) {
                                String tipoRel = isRealization ? "REALIZACION" : "DEPENDENCIA";
                                crearRelacionSiNoExiste(diagrama, cOrig, cDest, tipoRel, el.getAttribute("name"), "1", "1", relacionesCreadasKeys);
                            }
                        }
                    }
                }
            }

            // 4. CUARTO PASO: Parsear Asociaciones y Clases de Asociación UML Estándar
            for (int i = 0; i < allElements.getLength(); i++) {
                Node node = allElements.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE) {
                    Element el = (Element) node;
                    String xmiType = getAttributeValue(el, "xmi:type", "type");
                    String tag = el.getTagName();

                    boolean isAssoc = "uml:Association".equalsIgnoreCase(xmiType) || "Association".equalsIgnoreCase(tag);
                    boolean isAssocClass = "uml:AssociationClass".equalsIgnoreCase(xmiType) || "AssociationClass".equalsIgnoreCase(tag);

                    if (isAssoc || isAssocClass) {
                        String relName = el.getAttribute("name");
                        String assocXmiId = getAttributeValue(el, "xmi:id", "id");
                        List<Element> ownedEnds = new ArrayList<>();
                        List<String> memberEndIds = new ArrayList<>();

                        NodeList children = el.getChildNodes();
                        for (int k = 0; k < children.getLength(); k++) {
                            if (children.item(k).getNodeType() == Node.ELEMENT_NODE) {
                                Element ch = (Element) children.item(k);
                                if ("ownedEnd".equalsIgnoreCase(ch.getTagName())) {
                                    ownedEnds.add(ch);
                                } else if ("memberEnd".equalsIgnoreCase(ch.getTagName())) {
                                    String idref = getAttributeValue(ch, "xmi:idref", "idref");
                                    if (idref != null) memberEndIds.add(idref);
                                }
                            }
                        }

                        Clase cOrig = null;
                        Clase cDest = null;
                        String cardOrig = "1";
                        String cardDest = "1";
                        String tipoRel = "ASOCIACION";

                        if (ownedEnds.size() >= 2) {
                            Element end1 = ownedEnds.get(0);
                            Element end2 = ownedEnds.get(1);

                            String t1 = getAttributeValue(end1, "type", "xmi:idref");
                            String t2 = getAttributeValue(end2, "type", "xmi:idref");

                            cOrig = xmiIdToClaseMap.get(t1);
                            cDest = xmiIdToClaseMap.get(t2);

                            String agg1 = end1.getAttribute("aggregation");
                            String agg2 = end2.getAttribute("aggregation");
                            if ("composite".equalsIgnoreCase(agg1) || "composite".equalsIgnoreCase(agg2)) {
                                tipoRel = "COMPOSICION";
                            } else if ("shared".equalsIgnoreCase(agg1) || "shared".equalsIgnoreCase(agg2)) {
                                tipoRel = "AGREGACION";
                            }
                        } else if (memberEndIds.size() >= 2) {
                            String prop1 = memberEndIds.get(0);
                            String prop2 = memberEndIds.get(1);

                            String class1Id = propertyToClassMap.get(prop1);
                            String class2Id = propertyToClassMap.get(prop2);

                            if (class1Id != null && class2Id != null) {
                                cOrig = xmiIdToClaseMap.get(class1Id);
                                cDest = xmiIdToClaseMap.get(class2Id);
                            }
                        }

                        if (cOrig != null && cDest != null) {
                            if (isAssocClass && assocXmiId != null && xmiIdToClaseMap.containsKey(assocXmiId)) {
                                Clase cAssoc = xmiIdToClaseMap.get(assocXmiId);
                                crearRelacionSiNoExiste(diagrama, cOrig, cDest, "ASOCIACION", "", cardOrig, cardDest, relacionesCreadasKeys);
                                crearRelacionSiNoExiste(diagrama, cAssoc, cDest, "CLASE_ASOCIACION", cOrig.getNombre() + ":" + cDest.getNombre(), "", "", relacionesCreadasKeys);
                            } else {
                                crearRelacionSiNoExiste(diagrama, cOrig, cDest, tipoRel, relName, cardOrig, cardDest, relacionesCreadasKeys);
                            }
                        }
                    }
                }
            }

            // 5. QUINTO PASO: Parsear Conectores Especiales de Enterprise Architect (<connector>)
            record EaConnectorData(String connId, String srcId, String dstId, String cardOrig, String cardDest, String eaType, String subtype, String name, String assocClassId) {}
            Map<String, EaConnectorData> eaConnectorMap = new LinkedHashMap<>();

            NodeList connectorNodes = doc.getElementsByTagName("connector");
            for (int i = 0; i < connectorNodes.getLength(); i++) {
                Node node = connectorNodes.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE) {
                    Element connEl = (Element) node;
                    String connId = getAttributeValue(connEl, "xmi:idref", "xmi:id", "id");

                    String srcId = null;
                    String dstId = null;
                    String cardOrig = "1";
                    String cardDest = "1";
                    String eaType = "Association";
                    String subtype = "";
                    String name = "";
                    String assocClassId = null;

                    NodeList srcList = connEl.getElementsByTagName("source");
                    if (srcList.getLength() > 0) {
                        Element s = (Element) srcList.item(0);
                        srcId = getAttributeValue(s, "xmi:idref", "idref");
                        NodeList mult = s.getElementsByTagName("multiplicity");
                        if (mult.getLength() > 0) cardOrig = ((Element) mult.item(0)).getAttribute("value");
                        if (cardOrig == null || cardOrig.isBlank()) {
                            NodeList typeList = s.getElementsByTagName("type");
                            if (typeList.getLength() > 0) cardOrig = ((Element) typeList.item(0)).getAttribute("multiplicity");
                        }
                    }

                    NodeList dstList = connEl.getElementsByTagName("target");
                    if (dstList.getLength() > 0) {
                        Element t = (Element) dstList.item(0);
                        dstId = getAttributeValue(t, "xmi:idref", "idref");
                        NodeList mult = t.getElementsByTagName("multiplicity");
                        if (mult.getLength() > 0) cardDest = ((Element) mult.item(0)).getAttribute("value");
                        if (cardDest == null || cardDest.isBlank()) {
                            NodeList typeList = t.getElementsByTagName("type");
                            if (typeList.getLength() > 0) cardDest = ((Element) typeList.item(0)).getAttribute("multiplicity");
                        }
                    }

                    NodeList propList = connEl.getElementsByTagName("properties");
                    if (propList.getLength() > 0) {
                        Element p = (Element) propList.item(0);
                        if (p.getAttribute("ea_type") != null) eaType = p.getAttribute("ea_type");
                        if (p.getAttribute("subtype") != null) subtype = p.getAttribute("subtype");
                        if (p.getAttribute("name") != null) name = p.getAttribute("name");
                    }

                    NodeList extPropsList = connEl.getElementsByTagName("extendedProperties");
                    if (extPropsList.getLength() > 0) {
                        Element ep = (Element) extPropsList.item(0);
                        if (ep.getAttribute("associationclass") != null && !ep.getAttribute("associationclass").isBlank()) {
                            assocClassId = ep.getAttribute("associationclass");
                        }
                    }

                    if (srcId != null && dstId != null) {
                        EaConnectorData cData = new EaConnectorData(connId, srcId, dstId, cardOrig, cardDest, eaType, subtype, name, assocClassId);
                        if (connId != null) eaConnectorMap.put(connId, cData);
                    }
                }
            }

            // Primer pase: Procesar conectores de EA
            for (EaConnectorData cData : eaConnectorMap.values()) {
                Clase cOrig = xmiIdToClaseMap.get(cData.srcId());
                Clase cDest = xmiIdToClaseMap.get(cData.dstId());

                if (cOrig != null && cDest != null) {
                    String tipoRel = "ASOCIACION";
                    String eaType = cData.eaType();
                    String subtype = cData.subtype();

                    if ("Generalization".equalsIgnoreCase(eaType)) {
                        tipoRel = "GENERALIZACION";
                    } else if ("Realisation".equalsIgnoreCase(eaType) || "Realization".equalsIgnoreCase(eaType)) {
                        tipoRel = "REALIZACION";
                    } else if ("Dependency".equalsIgnoreCase(eaType) || "Usage".equalsIgnoreCase(eaType)) {
                        tipoRel = "DEPENDENCIA";
                    } else if ("Aggregation".equalsIgnoreCase(eaType) || "Shared".equalsIgnoreCase(subtype)) {
                        tipoRel = "AGREGACION";
                    } else if ("Composition".equalsIgnoreCase(eaType) || "Composite".equalsIgnoreCase(subtype)) {
                        tipoRel = "COMPOSICION";
                    }

                    // Crear la relación base
                    crearRelacionSiNoExiste(diagrama, cOrig, cDest, tipoRel, cData.name(), cData.cardOrig(), cData.cardDest(), relacionesCreadasKeys);

                    // Si el conector tiene una clase de asociación vinculada directamente en extendedProperties
                    if (cData.assocClassId() != null && xmiIdToClaseMap.containsKey(cData.assocClassId())) {
                        Clase cAssoc = xmiIdToClaseMap.get(cData.assocClassId());
                        crearRelacionSiNoExiste(diagrama, cAssoc, cDest, "CLASE_ASOCIACION", cOrig.getNombre() + ":" + cDest.getNombre(), "", "", relacionesCreadasKeys);
                    }
                }
            }

            // Segundo pase: Clases de asociación referenciadas mediante conID en <extendedProperties>
            for (Map.Entry<String, String> entry : classToAssocConnectorMap.entrySet()) {
                String classId = entry.getKey();
                String baseConnId = entry.getValue();
                Clase cAssoc = xmiIdToClaseMap.get(classId);
                EaConnectorData baseConn = eaConnectorMap.get(baseConnId);
                if (cAssoc != null && baseConn != null) {
                    Clase cA = xmiIdToClaseMap.get(baseConn.srcId());
                    Clase cB = xmiIdToClaseMap.get(baseConn.dstId());
                    if (cA != null && cB != null) {
                        crearRelacionSiNoExiste(diagrama, cA, cB, "ASOCIACION", "", baseConn.cardOrig(), baseConn.cardDest(), relacionesCreadasKeys);
                        crearRelacionSiNoExiste(diagrama, cAssoc, cB, "CLASE_ASOCIACION", cA.getNombre() + ":" + cB.getNombre(), "", "", relacionesCreadasKeys);
                    }
                }
            }

            diagramaRepository.save(diagrama);

        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Error al importar archivo XMI de Enterprise Architect: " + e.getMessage(), e);
        }
    }

    private void crearRelacionSiNoExiste(DiagramaUml diagrama, Clase cOrig, Clase cDest, String tipoRel, String nombre, String cardOrig, String cardDest, Set<String> clavesCreadas) {
        String key1 = cOrig.getId() + "_" + cDest.getId() + "_" + tipoRel.toUpperCase();
        String key2 = cDest.getId() + "_" + cOrig.getId() + "_" + tipoRel.toUpperCase();

        if (clavesCreadas.contains(key1) || ("ASOCIACION".equalsIgnoreCase(tipoRel) && clavesCreadas.contains(key2))) {
            return;
        }

        List<RelacionClase> existentes = relacionRepository.findByDiagramaId(diagrama.getId());
        boolean yaExiste = existentes.stream().anyMatch(r ->
                ((r.getClaseOrigen().getId().equals(cOrig.getId()) && r.getClaseDestino().getId().equals(cDest.getId())) ||
                 (r.getClaseOrigen().getId().equals(cDest.getId()) && r.getClaseDestino().getId().equals(cOrig.getId()) && "ASOCIACION".equalsIgnoreCase(tipoRel))) &&
                r.getTipoRelacion().equalsIgnoreCase(tipoRel)
        );

        if (!yaExiste) {
            RelacionClase rel = new RelacionClase();
            rel.setDiagrama(diagrama);
            rel.setClaseOrigen(cOrig);
            rel.setClaseDestino(cDest);
            rel.setTipoRelacion(tipoRel);
            rel.setNombre(nombre != null ? nombre : "");
            rel.setCardinalidadOrigen(cardOrig != null && !cardOrig.isEmpty() ? cardOrig : "1");
            rel.setCardinalidadDestino(cardDest != null && !cardDest.isEmpty() ? cardDest : "1");
            relacionRepository.save(rel);
            clavesCreadas.add(key1);
            if ("ASOCIACION".equalsIgnoreCase(tipoRel)) clavesCreadas.add(key2);
        }
    }

    private String getAttributeValue(Element el, String... attrNames) {
        for (String attr : attrNames) {
            if (el.hasAttribute(attr) && !el.getAttribute(attr).isEmpty()) {
                return el.getAttribute(attr);
            }
        }
        return null;
    }

    private String getChildElementValue(Element el, String childTag, String attrName) {
        NodeList list = el.getElementsByTagName(childTag);
        if (list.getLength() > 0) {
            Element ch = (Element) list.item(0);
            return ch.getAttribute(attrName);
        }
        return null;
    }

    private String parseDataType(Element propElement) {
        String resultado = "String";

        NodeList typeNodes = propElement.getElementsByTagName("type");
        if (typeNodes.getLength() > 0) {
            Element typeEl = (Element) typeNodes.item(0);
            String href = typeEl.getAttribute("href");
            if (href != null && href.contains("#")) {
                resultado = href.substring(href.lastIndexOf("#") + 1);
            } else {
                String name = typeEl.getAttribute("name");
                if (name != null && !name.isEmpty()) resultado = name;
            }
        } else {
            NodeList propNodes = propElement.getElementsByTagName("properties");
            if (propNodes.getLength() > 0) {
                Element pEl = (Element) propNodes.item(0);
                String type = pEl.getAttribute("type");
                if (type != null && !type.isEmpty()) resultado = type;
            } else {
                String typeAttr = propElement.getAttribute("type");
                if (typeAttr != null && !typeAttr.isEmpty()) resultado = typeAttr;
            }
        }

        return limpiarTipoDatoEa(resultado);
    }

    private String limpiarTipoDatoEa(String tipo) {
        if (tipo == null || tipo.isBlank()) return "String";
        String t = tipo.trim();
        while (t.startsWith("EAJava_") || t.startsWith("EAUML_") || t.startsWith("EAC_")) {
            t = t.substring(t.indexOf('_') + 1);
        }
        return t.trim().isEmpty() ? "String" : t.trim();
    }
}
