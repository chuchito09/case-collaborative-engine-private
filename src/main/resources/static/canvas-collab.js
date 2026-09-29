const canvas = document.getElementById('lienzo');
const ctx = canvas.getContext('2d');
const cursoresContainer = document.getElementById('cursores-container');

let stompClient = null;
let diagramData = { clases: [], relaciones: [] };
let myUserId = 1;
let currentSessionToken = null;
let currentProyectoId = null;

// Modos del Lienzo
const MODE_POINTER = 'POINTER';
const MODE_RELATION = 'RELATION';
let canvasMode = MODE_POINTER;
let selectedRelationType = 'ASOCIACION';
let relationSourceClass = null;

// Estados de Selección
let selectedClases = []; // Array de clases seleccionadas (soporte selección múltiple)
let selectedClase = null; // Clase principal enfocada
let selectedRelacion = null; // Relación seleccionada (línea)

// Marquee Selection Box
let isMarqueeSelecting = false;
let marqueeStart = { x: 0, y: 0 };
let marqueeEnd = { x: 0, y: 0 };

// UI Elements: Quick Actions Clases
const quickActionsBar = document.getElementById('class-quick-actions');
const btnQuickInspect = document.getElementById('btn-quick-inspect');
const btnQuickConnect = document.getElementById('btn-quick-connect');
const btnQuickDelete = document.getElementById('btn-quick-delete');

// UI Elements: Quick Actions Relaciones
const quickRelActionsBar = document.getElementById('relation-quick-actions');
const btnQuickInspectRel = document.getElementById('btn-quick-inspect-rel');
const btnQuickDeleteRel = document.getElementById('btn-quick-delete-rel');

// UI Modal Inspector Relación
const modalInspectorRel = document.getElementById('modal-inspector-relation');
const inspectorRelName = document.getElementById('inspector-rel-name');
const inspectorRelType = document.getElementById('inspector-rel-type');
const inspectorRelCardOrig = document.getElementById('inspector-rel-card-orig');
const inspectorRelCardDest = document.getElementById('inspector-rel-card-dest');
const btnCloseRelInspector = document.getElementById('btn-close-rel-inspector');
const btnInspectorCancelRel = document.getElementById('btn-inspector-cancel-rel');
const btnInspectorSaveRel = document.getElementById('btn-inspector-save-rel');
const btnInspectorDeleteRel = document.getElementById('btn-inspector-delete-rel');

// UI Modal Inspector Clase & Atributos
const modalInspector = document.getElementById('modal-inspector-class');
const inspectorClassName = document.getElementById('inspector-class-name');
const inspectorStereotype = document.getElementById('inspector-class-stereotype');
const inspectorAttrList = document.getElementById('inspector-attr-list');
const inspectorAttrCount = document.getElementById('inspector-attr-count');
const btnCloseInspector = document.getElementById('btn-close-inspector');
const btnInspectorCancel = document.getElementById('btn-inspector-cancel');
const btnInspectorSave = document.getElementById('btn-inspector-save');
const btnInspectorDeleteClass = document.getElementById('btn-inspector-delete-class');

const newAttrVis = document.getElementById('new-attr-vis');
const newAttrName = document.getElementById('new-attr-name');
const newAttrType = document.getElementById('new-attr-type');
const newAttrPk = document.getElementById('new-attr-pk');
const btnAddAttrConfirm = document.getElementById('btn-add-attr-confirm');

// UI Modal Inspector Métodos
const inspectorMethodList = document.getElementById('inspector-method-list');
const inspectorMethodCount = document.getElementById('inspector-method-count');
const newMethodVis = document.getElementById('new-method-vis');
const newMethodName = document.getElementById('new-method-name');
const newMethodType = document.getElementById('new-method-type');
const btnAddMethodConfirm = document.getElementById('btn-add-method-confirm');

// UI Modal Add Class
const modalAddClass = document.getElementById('modal-add-class');
const modalAddClassTitle = document.getElementById('modal-add-class-title');
const inputClassName = document.getElementById('input-class-name');
const inputAttrName = document.getElementById('input-attr-name');
const inputAttrType = document.getElementById('input-attr-type');
const btnCancelClass = document.getElementById('btn-cancel-class');
const btnConfirmClass = document.getElementById('btn-confirm-class');
let pendingClassKind = 'CLASS';

// UI Modal Relaciones
const modalAddRelation = document.getElementById('modal-add-relation');
const selectRelationType = document.getElementById('select-relation-type');
const btnConfirmRelation = document.getElementById('btn-confirm-relation');
const btnCancelRelation = document.getElementById('btn-cancel-relation');
let pendingRelationTarget = null;

// Colores del Lienzo UML (Slate Dark Theme)
const colorFondo = "#262C36";
const colorHeader = "#1E222B";
const colorTextoPrincipal = "#F3F4F6";
const colorTextoSecundario = "#9CA3AF";
const colorBordeNormal = "#3B4252";
const colorBordeSeleccionado = "#3B82F6";
const colorBordeBloqueado = "#EF4444";
const colorBordeRelacion = "#10B981";
const colorRelacionSeleccionada = "#38BDF8";

// Estado de Pan y Zoom del Lienzo (Navegación / Desplazamiento)
let panX = 0;
let panY = 0;
let zoomCanvas = 1.0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

// Estado de Drag & Drop
let isDragging = false;
let dragOriginPositions = new Map(); // Mapa con posiciones iniciales de cada clase al comenzar drag
let dragStartX = 0, dragStartY = 0;
let lastMouseUpdate = 0;
let lastClickTime = 0;

function updateWorkspaceGridPosition() {
    const ws = document.getElementById('view-workspace');
    if (ws) {
        ws.style.backgroundPosition = `${panX}px ${panY}px`;
        ws.style.backgroundSize = `${20 * zoomCanvas}px ${20 * zoomCanvas}px`;
    }
}

function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width = parent ? parent.clientWidth : window.innerWidth;
    canvas.height = parent ? parent.clientHeight : window.innerHeight;
    updateWorkspaceGridPosition();
    render();
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));

// Observar redimensionamiento del contenedor en tiempo real
if (window.ResizeObserver) {
    const parentEl = document.getElementById('canvas-container') || document.getElementById('view-workspace');
    if (parentEl) {
        new ResizeObserver(() => resizeCanvas()).observe(parentEl);
    }
}

function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasPxX = (e.clientX - rect.left) * scaleX;
    const canvasPxY = (e.clientY - rect.top) * scaleY;
    return {
        x: (canvasPxX - panX) / zoomCanvas,
        y: (canvasPxY - panY) / zoomCanvas,
        screenX: e.clientX,
        screenY: e.clientY
    };
}

function getClassDimensions(c) {
    const width = 190;
    const attrs = (c.atributos && c.atributos.length > 0) ? c.atributos : [];
    const attrCount = attrs.length > 0 ? attrs.length : 1;
    const methods = (c.metodos && c.metodos.length > 0) ? c.metodos : [];
    const methodCount = methods.length;
    const hasStereotype = c.estereotipo && c.estereotipo !== 'CLASS';
    const headerHeight = hasStereotype ? 42 : 34;
    const attrHeight = Math.max(34, attrCount * 20 + 8);
    const methodHeight = methodCount > 0 ? (methodCount * 18 + 8) : 0;
    const height = headerHeight + attrHeight + methodHeight;
    return { width, height, headerHeight, attrHeight, methodHeight, hasStereotype, methods };
}

function findClassAt(x, y) {
    for (let i = diagramData.clases.length - 1; i >= 0; i--) {
        const c = diagramData.clases[i];
        const dim = getClassDimensions(c);
        if (x >= c.posX && x <= c.posX + dim.width &&
            y >= c.posY && y <= c.posY + dim.height) {
            return c;
        }
    }
    return null;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
}

function getRelOrigId(r) {
    if (!r) return null;
    if (r.claseOrigen && r.claseOrigen.id !== undefined && r.claseOrigen.id !== null) return String(r.claseOrigen.id);
    if (r.origenId !== undefined && r.origenId !== null) return String(r.origenId);
    if (r.claseOrigen) return String(r.claseOrigen);
    return null;
}

function getRelDestId(r) {
    if (!r) return null;
    if (r.claseDestino && r.claseDestino.id !== undefined && r.claseDestino.id !== null) return String(r.claseDestino.id);
    if (r.destinoId !== undefined && r.destinoId !== null) return String(r.destinoId);
    if (r.claseDestino) return String(r.claseDestino);
    return null;
}

function findBestBaseRelationForAssociation(origen, destino, relNombre) {
    if (!diagramData || !diagramData.relaciones || diagramData.relaciones.length === 0) return null;

    // 1. Coincidencia explícita si relNombre define las clases base (ej. "Venta:Producto" o "Venta-Producto")
    if (relNombre && (relNombre.includes(':') || relNombre.includes('-'))) {
        const sep = relNombre.includes(':') ? ':' : '-';
        const parts = relNombre.split(sep).map(s => s.trim().toLowerCase());
        if (parts.length === 2 && parts[0] && parts[1]) {
            const exactMatch = diagramData.relaciones.find(rb => {
                if (rb.tipoRelacion === 'CLASE_ASOCIACION') return false;
                const cA = diagramData.clases.find(c => String(c.id) === getRelOrigId(rb));
                const cB = diagramData.clases.find(c => String(c.id) === getRelDestId(rb));
                if (!cA || !cB) return false;
                const nA = (cA.nombre || '').trim().toLowerCase();
                const nB = (cB.nombre || '').trim().toLowerCase();
                return (nA === parts[0] && nB === parts[1]) || (nA === parts[1] && nB === parts[0]);
            });
            if (exactMatch) return exactMatch;
        }
    }

    // 2. Relaciones candidatas continuas conectadas a destino (o en general)
    let candidateRels = diagramData.relaciones.filter(rb => 
        rb.tipoRelacion !== 'CLASE_ASOCIACION' &&
        destino && (String(getRelOrigId(rb)) === String(destino.id) || String(getRelDestId(rb)) === String(destino.id))
    );

    if (candidateRels.length === 0) {
        candidateRels = diagramData.relaciones.filter(rb => rb.tipoRelacion !== 'CLASE_ASOCIACION');
    }

    if (candidateRels.length === 0) return null;
    if (candidateRels.length === 1) return candidateRels[0];

    // 3. Resolución Geométrica por Distancia Euclidiana Mínima al centro de la clase origen
    const dimOrig = getClassDimensions(origen);
    const origCenterX = origen.posX + dimOrig.width / 2;
    const origCenterY = origen.posY + dimOrig.height / 2;

    let bestRel = null;
    let minDistance = Infinity;

    for (const rb of candidateRels) {
        const cA = diagramData.clases.find(c => String(c.id) === getRelOrigId(rb));
        const cB = diagramData.clases.find(c => String(c.id) === getRelDestId(rb));
        if (!cA || !cB) continue;
        const dimA = getClassDimensions(cA);
        const dimB = getClassDimensions(cB);
        const midX = ((cA.posX + dimA.width / 2) + (cB.posX + dimB.width / 2)) / 2;
        const midY = ((cA.posY + dimA.height / 2) + (cB.posY + dimB.height / 2)) / 2;

        const dist = Math.hypot(origCenterX - midX, origCenterY - midY);
        if (dist < minDistance) {
            minDistance = dist;
            bestRel = rb;
        }
    }

    return bestRel || candidateRels[0];
}

function getBoxAnchorPoint(clase, targetX, targetY) {
    const dim = getClassDimensions(clase);
    const cx = clase.posX + dim.width / 2;
    const cy = clase.posY + dim.height / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;

    if (Math.abs(dy) * dim.width > Math.abs(dx) * dim.height) {
        return {
            x: cx,
            y: dy > 0 ? (clase.posY + dim.height) : clase.posY
        };
    } else {
        return {
            x: dx > 0 ? (clase.posX + dim.width) : clase.posX,
            y: cy
        };
    }
}

function findRelationAt(x, y) {
    const tolerance = 12;
    for (let i = diagramData.relaciones.length - 1; i >= 0; i--) {
        const r = diagramData.relaciones[i];
        const origId = getRelOrigId(r);
        const destId = getRelDestId(r);
        const origen = diagramData.clases.find(c => String(c.id) === origId);
        const destino = diagramData.clases.find(c => String(c.id) === destId);
        if (origen && destino) {
            const dimOrig = getClassDimensions(origen);
            const dimDest = getClassDimensions(destino);
            let x1 = origen.posX + dimOrig.width / 2;
            let y1 = origen.posY + dimOrig.height / 2;
            let x2 = destino.posX + dimDest.width / 2;
            let y2 = destino.posY + dimDest.height / 2;

            if (r.tipoRelacion === 'CLASE_ASOCIACION') {
                const baseRel = findBestBaseRelationForAssociation(origen, destino, r.nombre);
                if (baseRel) {
                    const cA = diagramData.clases.find(c => String(c.id) === getRelOrigId(baseRel));
                    const cB = diagramData.clases.find(c => String(c.id) === getRelDestId(baseRel));
                    if (cA && cB) {
                        const dimA = getClassDimensions(cA);
                        const dimB = getClassDimensions(cB);
                        x2 = ((cA.posX + dimA.width / 2) + (cB.posX + dimB.width / 2)) / 2;
                        y2 = ((cA.posY + dimA.height / 2) + (cB.posY + dimB.height / 2)) / 2;
                    }
                }
                const anchor = getBoxAnchorPoint(origen, x2, y2);
                x1 = anchor.x;
                y1 = anchor.y;
            }

            const dist = pointToSegmentDistance(x, y, x1, y1, x2, y2);
            if (dist <= tolerance) {
                return { 
                    relacion: r, 
                    origen, 
                    destino, 
                    midX: (x1 + x2) / 2, 
                    midY: (y1 + y2) / 2 
                };
            }
        }
    }
    return null;
}

// ==============================================
// TOOLBOX ENTERPRISE ARCHITECT INTERACTION
// ==============================================
function initToolbox() {
    if (window.__toolboxInitialized) return;
    window.__toolboxInitialized = true;
    document.querySelectorAll('.ea-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const items = header.nextElementSibling;
            const icon = header.querySelector('.material-icons');
            if (items.style.display === 'none') {
                items.style.display = 'block';
                if (icon) icon.textContent = 'expand_more';
            } else {
                items.style.display = 'none';
                if (icon) icon.textContent = 'chevron_right';
            }
        });
    });

    const searchInput = document.getElementById('toolbox-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.ea-tool-item').forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });
    }

    const btnToggle = document.getElementById('btn-toggle-toolbox');
    const toolboxContent = document.getElementById('toolbox-items-container');
    if (btnToggle && toolboxContent) {
        btnToggle.addEventListener('click', () => {
            if (toolboxContent.style.display === 'none') {
                toolboxContent.style.display = 'block';
                btnToggle.textContent = 'unfold_less';
            } else {
                toolboxContent.style.display = 'none';
                btnToggle.textContent = 'unfold_more';
            }
        });
    }

    const btnToggleKpi = document.getElementById('btn-toggle-kpi');
    const kpiPanel = document.getElementById('kpi-panel');
    if (btnToggleKpi && kpiPanel) {
        btnToggleKpi.addEventListener('click', () => {
            kpiPanel.classList.toggle('collapsed');
        });
    }

    const btnSelectAll = document.getElementById('btn-select-all');
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => {
            selectedClases = [...diagramData.clases];
            selectedClase = selectedClases.length > 0 ? selectedClases[0] : null;
            selectedRelacion = null;
            updateQuickActionsPosition();
            updateQuickRelActionsPosition();
            render();
        });
    }

    document.querySelectorAll('.ea-tool-item').forEach(tool => {
        tool.addEventListener('click', () => {
            const action = tool.getAttribute('data-action');
            
            if (action === 'create-class') {
                pendingClassKind = tool.getAttribute('data-kind') || 'CLASS';
                const titles = {
                    CLASS: 'Nueva Clase UML',
                    INTERFACE: 'Nueva Interfaz <<interface>>',
                    ENUM: 'Nueva Enumeración <<enumeration>>',
                    DATATYPE: 'Nuevo Tipo de Dato <<dataType>>',
                    PACKAGE: 'Nuevo Paquete <<package>>'
                };
                if (modalAddClassTitle) modalAddClassTitle.textContent = titles[pendingClassKind] || 'Nuevo Elemento';
                modalAddClass.classList.remove('hidden');
                inputClassName.focus();
                
                clearActiveToolItems();
                canvasMode = MODE_POINTER;
                relationSourceClass = null;
            } else if (action === 'relation') {
                const type = tool.getAttribute('data-type');
                clearActiveToolItems();
                tool.classList.add('active');
                canvasMode = MODE_RELATION;
                selectedRelationType = type;
                relationSourceClass = selectedClase || null;
                render();
            }
        });
    });
}

function clearActiveToolItems() {
    document.querySelectorAll('.ea-tool-item').forEach(t => t.classList.remove('active'));
}

function updateQuickActionsPosition() {
    if (!selectedClase || selectedClases.length === 0 || !quickActionsBar) {
        if (quickActionsBar) quickActionsBar.classList.add('hidden');
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    const canvasPxX = selectedClase.posX * zoomCanvas + panX;
    const canvasPxY = selectedClase.posY * zoomCanvas + panY;

    const screenX = rect.left + (canvasPxX * scaleX);
    const screenY = rect.top + (canvasPxY * scaleY);

    quickActionsBar.style.left = `${Math.max(10, screenX)}px`;
    quickActionsBar.style.top = `${Math.max(60, screenY - 8)}px`;
    quickActionsBar.classList.remove('hidden');
}

function updateQuickRelActionsPosition() {
    if (!selectedRelacion || !quickRelActionsBar) {
        if (quickRelActionsBar) quickRelActionsBar.classList.add('hidden');
        return;
    }
    const origId = getRelOrigId(selectedRelacion);
    const destId = getRelDestId(selectedRelacion);
    const origen = diagramData.clases.find(c => String(c.id) === origId);
    const destino = diagramData.clases.find(c => String(c.id) === destId);
    if (!origen || !destino) {
        quickRelActionsBar.classList.add('hidden');
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    const midX = (origen.posX + destino.posX + 190) / 2;
    const midY = (origen.posY + destino.posY + 70) / 2;

    const canvasPxX = midX * zoomCanvas + panX;
    const canvasPxY = midY * zoomCanvas + panY;

    const screenX = rect.left + (canvasPxX * scaleX);
    const screenY = rect.top + (canvasPxY * scaleY);

    quickRelActionsBar.style.left = `${Math.max(10, screenX)}px`;
    quickRelActionsBar.style.top = `${Math.max(60, screenY - 8)}px`;
    quickRelActionsBar.classList.remove('hidden');
}

// ==============================================
// INSPECTOR DE RELACIÓN
// ==============================================
function openRelationInspector(rel) {
    if (!rel) return;
    selectedRelacion = rel;
    inspectorRelName.value = rel.nombre || '';
    inspectorRelType.value = rel.tipoRelacion || rel.tipo || 'ASOCIACION';
    inspectorRelCardOrig.value = rel.cardinalidadOrigen || '1';
    inspectorRelCardDest.value = rel.cardinalidadDestino || '1';
    modalInspectorRel.classList.remove('hidden');
}

function closeRelationInspector() {
    modalInspectorRel.classList.add('hidden');
}

if (btnQuickInspectRel) btnQuickInspectRel.addEventListener('click', () => openRelationInspector(selectedRelacion));
if (btnCloseRelInspector) btnCloseRelInspector.addEventListener('click', closeRelationInspector);
if (btnInspectorCancelRel) btnInspectorCancelRel.addEventListener('click', closeRelationInspector);

if (btnQuickDeleteRel) btnQuickDeleteRel.addEventListener('click', () => eliminarRelacionActual(selectedRelacion));
if (btnInspectorDeleteRel) btnInspectorDeleteRel.addEventListener('click', () => eliminarRelacionActual(selectedRelacion));

if (btnInspectorSaveRel) {
    btnInspectorSaveRel.addEventListener('click', () => {
        if (!selectedRelacion) return;
        selectedRelacion.nombre = inspectorRelName.value.trim();
        selectedRelacion.tipoRelacion = inspectorRelType.value;
        selectedRelacion.cardinalidadOrigen = inspectorRelCardOrig.value.trim() || '1';
        selectedRelacion.cardinalidadDestino = inspectorRelCardDest.value.trim() || '1';

        if (stompClient && stompClient.connected && !String(selectedRelacion.id).startsWith('temp-rel-')) {
            stompClient.publish({
                destination: `/app/sala/${currentSessionToken}/relacion/mutar`,
                body: JSON.stringify({
                    relacionId: selectedRelacion.id,
                    nombre: selectedRelacion.nombre,
                    tipoRelacion: selectedRelacion.tipoRelacion,
                    cardinalidadOrigen: selectedRelacion.cardinalidadOrigen,
                    cardinalidadDestino: selectedRelacion.cardinalidadDestino,
                    action: 'UPDATE'
                })
            });
        }

        closeRelationInspector();
        render();
        if (window.CaseCollab) {
            window.CaseCollab.guardarAvance(false);
        }
    });
}

function eliminarRelacionActual(rel) {
    if (!rel) return;
    if (!confirm('¿Eliminar esta relación?')) return;

    diagramData.relaciones = diagramData.relaciones.filter(r => r !== rel && r.id !== rel.id);

    if (stompClient && stompClient.connected && rel.id && !String(rel.id).startsWith('temp-rel-')) {
        stompClient.publish({
            destination: `/app/sala/${currentSessionToken}/relacion/eliminar`,
            body: JSON.stringify({ relacionId: rel.id })
        });
    }

    selectedRelacion = null;
    closeRelationInspector();
    updateQuickRelActionsPosition();
    render();
}

// ==============================================
// INSPECTOR Y EDICIÓN DE CLASE & ATRIBUTOS (INLINE EDIT)
// ==============================================
function openClassInspector(clase) {
    if (!clase) return;
    selectedClase = clase;
    inspectorClassName.value = clase.nombre || '';
    inspectorStereotype.value = clase.estereotipo || 'CLASS';
    renderInspectorAttributes(clase);
    renderInspectorMethods(clase);
    modalInspector.classList.remove('hidden');
}

function closeClassInspector() {
    modalInspector.classList.add('hidden');
}

function renderInspectorMethods(clase) {
    if (!inspectorMethodList) return;
    inspectorMethodList.innerHTML = '';
    const methods = clase.metodos || [];
    if (inspectorMethodCount) inspectorMethodCount.textContent = `${methods.length} métodos`;

    if (methods.length === 0) {
        inspectorMethodList.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 8px;">No hay métodos definidos. Agrega uno abajo.</div>';
        return;
    }

    methods.forEach(method => {
        const row = document.createElement('div');
        row.className = 'inspector-attr-row';
        row.setAttribute('data-method-id', method.id);
        row.style.gridTemplateColumns = '85px 1fr 90px 40px';
        const visSymbol = method.visibilidad === 'private' ? '- private' : (method.visibilidad === 'protected' ? '# protected' : (method.visibilidad === 'package' ? '~ package' : '+ public'));
        
        row.innerHTML = `
            <span style="color: #60A5FA; font-weight: 500;">${visSymbol}</span>
            <span style="font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;">${method.nombre}()</span>
            <span style="color: #34D399; font-size: 11px;">${method.tipoRetorno || method.tipo || 'void'}</span>
            <div class="flex gap-1 justify-end">
                <button type="button" class="btn btn-ghost btn-del-method" style="padding: 2px 4px; color: var(--status-danger);" title="Eliminar Método">
                    <span class="material-icons" style="font-size: 16px;">delete</span>
                </button>
            </div>
        `;

        const btnDel = row.querySelector('.btn-del-method');
        btnDel.addEventListener('click', () => {
            eliminarMetodo(clase, method);
        });

        inspectorMethodList.appendChild(row);
    });
}

function agregarMetodo(clase, vis, nombre, tipoRetorno) {
    if (!nombre.trim()) return;
    let cleanName = nombre.trim();
    if (cleanName.endsWith('()')) {
        cleanName = cleanName.slice(0, -2);
    }
    const nuevoMetodo = {
        id: 'temp-met-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        nombre: cleanName,
        tipoRetorno: tipoRetorno || 'void',
        visibilidad: vis || 'public',
        orden: (clase.metodos ? clase.metodos.length : 0)
    };

    if (!clase.metodos) clase.metodos = [];
    clase.metodos.push(nuevoMetodo);

    renderInspectorMethods(clase);
    render();
}

function eliminarMetodo(clase, method) {
    clase.metodos = (clase.metodos || []).filter(m => m !== method && m.id !== method.id);
    renderInspectorMethods(clase);
    render();
}

function renderInspectorAttributes(clase) {
    if (!inspectorAttrList) return;
    inspectorAttrList.innerHTML = '';
    const attrs = clase.atributos || [];
    if (inspectorAttrCount) inspectorAttrCount.textContent = `${attrs.length} atributos`;

    if (attrs.length === 0) {
        inspectorAttrList.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px; padding: 8px;">No hay atributos definidos. Agrega uno abajo.</div>';
        return;
    }

    attrs.forEach(attr => {
        const row = document.createElement('div');
        row.className = 'inspector-attr-row';
        row.setAttribute('data-attr-id', attr.id);
        row.style.gridTemplateColumns = '85px 1fr 100px 35px 65px';
        const visSymbol = attr.visibilidad === 'private' ? '- private' : (attr.visibilidad === 'protected' ? '# protected' : (attr.visibilidad === 'package' ? '~ package' : '+ public'));
        
        row.innerHTML = `
            <span style="color: #60A5FA; font-weight: 500;">${visSymbol}</span>
            <span style="font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis;">${attr.nombre}</span>
            <span style="color: #A78BFA; font-size: 11px;">${attr.tipoDato || attr.tipo || 'String'}</span>
            <span style="color: ${attr.esPk ? '#10B981' : 'transparent'}; font-weight: bold; font-size: 10px;">${attr.esPk ? 'PK' : ''}</span>
            <div class="flex gap-1">
                <button class="btn btn-ghost btn-edit-attr" style="padding: 2px 4px; color: #60A5FA;" title="Editar Atributo">
                    <span class="material-icons" style="font-size: 16px;">edit</span>
                </button>
                <button class="btn btn-ghost btn-del-attr" style="padding: 2px 4px; color: var(--status-danger);" title="Eliminar Atributo">
                    <span class="material-icons" style="font-size: 16px;">delete</span>
                </button>
            </div>
        `;

        // Botón Editar Inline
        const btnEdit = row.querySelector('.btn-edit-attr');
        btnEdit.addEventListener('click', () => {
            renderInlineAttributeEditor(clase, attr, row);
        });

        // Botón Eliminar
        const btnDel = row.querySelector('.btn-del-attr');
        btnDel.addEventListener('click', () => {
            eliminarAtributo(clase, attr);
        });

        inspectorAttrList.appendChild(row);
    });
}

function renderInlineAttributeEditor(clase, attr, rowContainer) {
    rowContainer.setAttribute('data-attr-id', attr.id);
    rowContainer.innerHTML = `
        <select class="edit-attr-vis" style="padding: 4px; background: var(--bg-input); border: 1px solid var(--accent-primary); color: var(--text-primary); border-radius: 4px; font-size: 11px;">
            <option value="private" ${attr.visibilidad === 'private' ? 'selected' : ''}>- Priv</option>
            <option value="public" ${attr.visibilidad === 'public' ? 'selected' : ''}>+ Pub</option>
            <option value="protected" ${attr.visibilidad === 'protected' ? 'selected' : ''}># Prot</option>
            <option value="package" ${attr.visibilidad === 'package' ? 'selected' : ''}>~ Pkg</option>
        </select>
        <input type="text" class="edit-attr-name" value="${attr.nombre}" style="padding: 4px 6px; font-size: 11px; border: 1px solid var(--accent-primary);">
        <input type="text" class="edit-attr-type" value="${attr.tipoDato || attr.tipo || 'String'}" style="padding: 4px 6px; font-size: 11px; border: 1px solid var(--accent-primary);">
        <label class="flex items-center text-xs" title="Clave Primaria">
            <input type="checkbox" class="edit-attr-pk" ${attr.esPk ? 'checked' : ''} style="width: auto;">
        </label>
        <div class="flex gap-1">
            <button class="btn btn-ghost btn-save-attr" style="padding: 2px 4px; color: #10B981;" title="Guardar Cambios">
                <span class="material-icons" style="font-size: 18px;">check</span>
            </button>
            <button class="btn btn-ghost btn-cancel-edit" style="padding: 2px 4px; color: var(--text-secondary);" title="Cancelar">
                <span class="material-icons" style="font-size: 18px;">close</span>
            </button>
        </div>
    `;

    const inputName = rowContainer.querySelector('.edit-attr-name');
    const inputType = rowContainer.querySelector('.edit-attr-type');
    const selectVis = rowContainer.querySelector('.edit-attr-vis');
    const checkPk = rowContainer.querySelector('.edit-attr-pk');
    const btnSave = rowContainer.querySelector('.btn-save-attr');
    const btnCancel = rowContainer.querySelector('.btn-cancel-edit');

    btnCancel.addEventListener('click', () => renderInspectorAttributes(clase));

    btnSave.addEventListener('click', () => {
        const nuevoNombre = inputName.value.trim();
        if (!nuevoNombre) return;

        attr.nombre = nuevoNombre;
        attr.tipoDato = inputType.value.trim() || 'String';
        attr.tipo = attr.tipoDato;
        attr.visibilidad = selectVis.value;
        attr.esPk = checkPk.checked;

        const liveClase = diagramData.clases.find(c => String(c.id) === String(clase.id));
        if (liveClase && liveClase.atributos) {
            const liveAttr = liveClase.atributos.find(a => String(a.id) === String(attr.id));
            if (liveAttr) {
                liveAttr.nombre = attr.nombre;
                liveAttr.tipoDato = attr.tipoDato;
                liveAttr.tipo = attr.tipo;
                liveAttr.visibilidad = attr.visibilidad;
                liveAttr.esPk = attr.esPk;
            }
        }

        if (stompClient && stompClient.connected && attr.id && !String(attr.id).startsWith('temp-attr-')) {
            stompClient.publish({
                destination: `/app/sala/${currentSessionToken}/atributo/mutar`,
                body: JSON.stringify({
                    atributoId: attr.id,
                    claseId: clase.id,
                    nombre: attr.nombre,
                    tipoDato: attr.tipoDato,
                    visibilidad: attr.visibilidad,
                    esPk: attr.esPk,
                    action: 'UPDATE'
                })
            });
        }

        renderInspectorAttributes(clase);
        render();
        if (window.CaseCollab) {
            window.CaseCollab.guardarAvance(false);
        }
    });
}

function agregarAtributo(clase, vis, nombre, tipo, esPk) {
    if (!nombre.trim()) return;
    const nuevoAttr = {
        id: 'temp-attr-' + Date.now(),
        nombre: nombre.trim(),
        tipoDato: tipo || 'String',
        tipo: tipo || 'String',
        visibilidad: vis || 'private',
        esPk: Boolean(esPk),
        orden: (clase.atributos ? clase.atributos.length : 0)
    };

    if (!clase.atributos) clase.atributos = [];
    clase.atributos.push(nuevoAttr);

    if (stompClient && stompClient.connected && !String(clase.id).startsWith('temp-')) {
        stompClient.publish({
            destination: `/app/sala/${currentSessionToken}/atributo/mutar`,
            body: JSON.stringify({
                claseId: clase.id,
                nombre: nuevoAttr.nombre,
                tipoDato: nuevoAttr.tipoDato,
                visibilidad: nuevoAttr.visibilidad,
                esPk: nuevoAttr.esPk,
                orden: nuevoAttr.orden,
                action: 'CREATE'
            })
        });
    }

    renderInspectorAttributes(clase);
    render();
}

function eliminarAtributo(clase, attr) {
    clase.atributos = (clase.atributos || []).filter(a => a !== attr && a.id !== attr.id);

    if (stompClient && stompClient.connected && attr.id && !String(attr.id).startsWith('temp-attr-')) {
        stompClient.publish({
            destination: `/app/sala/${currentSessionToken}/atributo/mutar`,
            body: JSON.stringify({
                atributoId: attr.id,
                claseId: clase.id,
                action: 'DELETE'
            })
        });
    }

    renderInspectorAttributes(clase);
    render();
}

function eliminarClaseActual(clase) {
    if (!clase) return;
    if (!confirm(`¿Estás seguro de eliminar la clase "${clase.nombre}" y sus relaciones?`)) return;

    diagramData.clases = diagramData.clases.filter(c => c.id !== clase.id);
    diagramData.relaciones = diagramData.relaciones.filter(r => 
        (r.claseOrigen ? r.claseOrigen.id : r.origenId) !== clase.id &&
        (r.claseDestino ? r.claseDestino.id : r.destinoId) !== clase.id
    );

    if (stompClient && stompClient.connected && !String(clase.id).startsWith('temp-')) {
        stompClient.publish({
            destination: `/app/sala/${currentSessionToken}/clase/eliminar`,
            body: JSON.stringify({ claseId: clase.id })
        });
    }

    selectedClases = selectedClases.filter(c => c.id !== clase.id);
    selectedClase = null;
    closeClassInspector();
    updateQuickActionsPosition();
    render();
}

// Listeners Inspector & Quick Actions
if (btnQuickInspect) btnQuickInspect.addEventListener('click', () => openClassInspector(selectedClase));
if (btnQuickDelete) btnQuickDelete.addEventListener('click', () => eliminarClaseActual(selectedClase));
if (btnQuickConnect) {
    btnQuickConnect.addEventListener('click', () => {
        if (!selectedClase) return;
        canvasMode = MODE_RELATION;
        relationSourceClass = selectedClase;
        selectedRelationType = 'ASOCIACION';
        render();
    });
}

if (btnCloseInspector) btnCloseInspector.addEventListener('click', closeClassInspector);
if (btnInspectorCancel) btnInspectorCancel.addEventListener('click', closeClassInspector);

if (btnInspectorSave) {
    btnInspectorSave.addEventListener('click', () => {
        if (!selectedClase) return;

        const liveClase = diagramData.clases.find(c => String(c.id) === String(selectedClase.id)) || selectedClase;
        selectedClase = liveClase;

        // 1. Guardar cualquier edición inline activa en la lista de atributos
        if (inspectorAttrList) {
            const inlineRows = inspectorAttrList.querySelectorAll('.inspector-attr-row');
            inlineRows.forEach(row => {
                const inputName = row.querySelector('.edit-attr-name');
                const inputType = row.querySelector('.edit-attr-type');
                const selectVis = row.querySelector('.edit-attr-vis');
                const checkPk = row.querySelector('.edit-attr-pk');
                
                if (inputName && inputType) {
                    const nuevoNombre = inputName.value.trim();
                    const attrId = row.getAttribute('data-attr-id');
                    const attr = (selectedClase.atributos || []).find(a => String(a.id) === String(attrId));
                    if (attr && nuevoNombre) {
                        attr.nombre = nuevoNombre;
                        attr.tipoDato = inputType.value.trim() || 'String';
                        attr.tipo = attr.tipoDato;
                        if (selectVis) attr.visibilidad = selectVis.value;
                        if (checkPk) attr.esPk = checkPk.checked;

                        if (stompClient && stompClient.connected && attr.id && !String(attr.id).startsWith('temp-attr-')) {
                            stompClient.publish({
                                destination: `/app/sala/${currentSessionToken}/atributo/mutar`,
                                body: JSON.stringify({
                                    atributoId: attr.id,
                                    claseId: selectedClase.id,
                                    nombre: attr.nombre,
                                    tipoDato: attr.tipoDato,
                                    visibilidad: attr.visibilidad,
                                    esPk: attr.esPk,
                                    action: 'UPDATE'
                                })
                            });
                        }
                    }
                }
            });
        }

        // 2. Si hay texto escrito en "+ Agregar Nuevo Atributo", agregarlo automáticamente
        if (newAttrName && newAttrName.value.trim()) {
            const nombre = newAttrName.value.trim();
            const tipo = newAttrType ? newAttrType.value.trim() : 'String';
            const vis = newAttrVis ? newAttrVis.value : 'private';
            const esPk = newAttrPk ? newAttrPk.checked : false;
            agregarAtributo(selectedClase, vis, nombre, tipo, esPk);
            newAttrName.value = '';
            if (newAttrPk) newAttrPk.checked = false;
        }

        // 2b. Si hay texto escrito en "+ Agregar Nuevo Método", agregarlo automáticamente
        if (newMethodName && newMethodName.value.trim()) {
            const mNombre = newMethodName.value.trim();
            const mTipo = newMethodType ? newMethodType.value.trim() : 'void';
            const mVis = newMethodVis ? newMethodVis.value : 'public';
            agregarMetodo(selectedClase, mVis, mNombre, mTipo);
            newMethodName.value = '';
        }

        // 3. Guardar Nombre y Estereotipo de la Clase
        selectedClase.nombre = inspectorClassName.value.trim() || selectedClase.nombre;
        selectedClase.estereotipo = inspectorStereotype.value;

        if (stompClient && stompClient.connected && !String(selectedClase.id).startsWith('temp-')) {
            stompClient.publish({
                destination: `/app/sala/${currentSessionToken}/clase/modificar`,
                body: JSON.stringify({
                    claseId: selectedClase.id,
                    nombre: selectedClase.nombre,
                    visibilidad: 'public'
                })
            });
        }

        // 4. Cerrar modal, actualizar lienzo y guardar avance en Base de Datos
        closeClassInspector();
        render();
        if (window.CaseCollab) {
            window.CaseCollab.guardarAvance(false);
        }
    });
}

if (btnInspectorDeleteClass) {
    btnInspectorDeleteClass.addEventListener('click', () => eliminarClaseActual(selectedClase));
}

if (btnAddAttrConfirm) {
    btnAddAttrConfirm.addEventListener('click', () => {
        if (!selectedClase) return;
        const nombre = newAttrName.value;
        const tipo = newAttrType.value;
        const vis = newAttrVis.value;
        const esPk = newAttrPk.checked;

        if (!nombre.trim()) {
            alert('Ingresa el nombre del atributo');
            return;
        }

        agregarAtributo(selectedClase, vis, nombre, tipo, esPk);
        newAttrName.value = '';
        newAttrPk.checked = false;
        newAttrName.focus();
    });
}

if (btnAddMethodConfirm) {
    btnAddMethodConfirm.addEventListener('click', () => {
        if (!selectedClase) return;
        const nombre = newMethodName.value;
        const tipo = newMethodType.value;
        const vis = newMethodVis.value;

        if (!nombre.trim()) {
            alert('Ingresa el nombre del método');
            return;
        }

        agregarMetodo(selectedClase, vis, nombre, tipo);
        newMethodName.value = '';
        newMethodName.focus();
    });
}

// Diálogo Crear Clase Rápida
if (btnCancelClass && !btnCancelClass.hasAttribute('data-bound')) {
    btnCancelClass.setAttribute('data-bound', 'true');
    btnCancelClass.addEventListener('click', () => modalAddClass.classList.add('hidden'));
}
if (btnConfirmClass && !btnConfirmClass.hasAttribute('data-bound')) {
    btnConfirmClass.setAttribute('data-bound', 'true');
    btnConfirmClass.addEventListener('click', () => {
        const nombre = inputClassName.value.trim();
        const attrName = inputAttrName.value.trim();
        const attrType = inputAttrType.value.trim();

        if (!nombre) {
            alert('La clase necesita un nombre');
            return;
        }

        window.CaseCollab.crearClase(nombre, attrName, attrType, pendingClassKind);
        modalAddClass.classList.add('hidden');
        inputClassName.value = '';
        inputAttrName.value = '';
        inputAttrType.value = '';
    });
}

// Diálogo Crear Relación
if (btnCancelRelation) {
    btnCancelRelation.addEventListener('click', () => {
        modalAddRelation.classList.add('hidden');
        relationSourceClass = null;
        pendingRelationTarget = null;
        canvasMode = MODE_POINTER;
        clearActiveToolItems();
        render();
    });
}

if (btnConfirmRelation) {
    btnConfirmRelation.addEventListener('click', () => {
        if (!relationSourceClass || !pendingRelationTarget) return;
        const tipo = selectRelationType.value;
        crearRelacionDirecta(relationSourceClass, pendingRelationTarget, tipo);
        modalAddRelation.classList.add('hidden');
    });
}

// Toast notification helper
function mostrarNotificacion(mensaje) {
    let notif = document.getElementById('case-toast-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'case-toast-notification';
        notif.style.position = 'fixed';
        notif.style.bottom = '24px';
        notif.style.right = '24px';
        notif.style.background = '#10B981';
        notif.style.color = '#FFFFFF';
        notif.style.padding = '12px 22px';
        notif.style.borderRadius = '8px';
        notif.style.boxShadow = '0 6px 20px rgba(0,0,0,0.35)';
        notif.style.fontWeight = '600';
        notif.style.fontSize = '14px';
        notif.style.zIndex = '99999';
        notif.style.display = 'flex';
        notif.style.alignItems = 'center';
        notif.style.gap = '10px';
        notif.style.transition = 'all 0.3s ease';
        document.body.appendChild(notif);
    }
    notif.innerHTML = `<span class="material-icons" style="font-size: 20px;">check_circle</span> ${mensaje}`;
    notif.style.opacity = '1';
    notif.style.transform = 'translateY(0)';
    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transform = 'translateY(10px)';
    }, 2800);
}

function crearRelacionDirecta(origen, destino, tipo) {
    if (!origen || !destino) return;
    
    if (tipo === 'CLASE_ASOCIACION') {
        // 1. Crear o verificar la relación base entre origen y destino si no existe
        const relBaseExistente = diagramData.relaciones.find(r => 
            (String(getRelOrigId(r)) === String(origen.id) && String(getRelDestId(r)) === String(destino.id)) ||
            (String(getRelOrigId(r)) === String(destino.id) && String(getRelDestId(r)) === String(origen.id))
        );

        if (!relBaseExistente) {
            const tempRelId = 'temp-rel-' + Date.now() + '-base';
            const nuevaRelBase = {
                id: tempRelId,
                tempId: tempRelId,
                claseOrigen: { id: origen.id },
                claseDestino: { id: destino.id },
                origenId: origen.id,
                destinoId: destino.id,
                tipoRelacion: 'ASOCIACION',
                cardinalidadOrigen: '0..*',
                cardinalidadDestino: '1..*'
            };
            diagramData.relaciones.push(nuevaRelBase);
            if (stompClient && stompClient.connected && !String(origen.id).startsWith('temp-') && !String(destino.id).startsWith('temp-')) {
                stompClient.publish({
                    destination: `/app/sala/${currentSessionToken}/relacion/agregar`,
                    body: JSON.stringify({
                        tempId: tempRelId,
                        origenId: origen.id,
                        destinoId: destino.id,
                        tipo: 'ASOCIACION'
                    })
                });
            }
        }

        // 2. Crear automáticamente la clase intermedia (Tabla de Asociación)
        const intermediateName = `Detalle_${origen.nombre}`;
        const midX = Math.round((origen.posX + destino.posX) / 2);
        const midY = Math.round((origen.posY + destino.posY) / 2) + 90;
        const intermediateClass = window.CaseCollab.crearClaseConAtributos(intermediateName, [], 'CLASS', midX, midY);

        // 3. Crear el enlace punteado de Clase de Asociación hacia la relación / destino
        if (intermediateClass) {
            const tempRelAssocId = 'temp-rel-' + (Date.now() + 50) + '-assoc';
            const assocName = `${origen.nombre}:${destino.nombre}`;
            const nuevaRelAssoc = {
                id: tempRelAssocId,
                tempId: tempRelAssocId,
                claseOrigen: { id: intermediateClass.id },
                claseDestino: { id: destino.id },
                origenId: intermediateClass.id,
                destinoId: destino.id,
                tipoRelacion: 'CLASE_ASOCIACION',
                cardinalidadOrigen: '',
                cardinalidadDestino: '',
                nombre: assocName
            };
            diagramData.relaciones.push(nuevaRelAssoc);
            if (stompClient && stompClient.connected && !String(intermediateClass.id).startsWith('temp-') && !String(destino.id).startsWith('temp-')) {
                stompClient.publish({
                    destination: `/app/sala/${currentSessionToken}/relacion/agregar`,
                    body: JSON.stringify({
                        tempId: tempRelAssocId,
                        origenId: intermediateClass.id,
                        destinoId: destino.id,
                        tipo: 'CLASE_ASOCIACION',
                        nombre: assocName
                    })
                });
            }
        }

        relationSourceClass = null;
        pendingRelationTarget = null;
        canvasMode = MODE_POINTER;
        clearActiveToolItems();
        render();
        return;
    }

    const tempRelId = 'temp-rel-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const nuevaRel = {
        id: tempRelId,
        tempId: tempRelId,
        claseOrigen: { id: origen.id },
        claseDestino: { id: destino.id },
        origenId: origen.id,
        destinoId: destino.id,
        tipoRelacion: tipo,
        cardinalidadOrigen: '1',
        cardinalidadDestino: '1'
    };
    diagramData.relaciones.push(nuevaRel);

    if (stompClient && stompClient.connected && !String(origen.id).startsWith('temp-') && !String(destino.id).startsWith('temp-')) {
        stompClient.publish({
            destination: `/app/sala/${currentSessionToken}/relacion/agregar`,
            body: JSON.stringify({ 
                tempId: tempRelId,
                origenId: origen.id, 
                destinoId: destino.id,
                tipo: tipo
            })
        });
    }

    relationSourceClass = null;
    pendingRelationTarget = null;
    canvasMode = MODE_POINTER;
    clearActiveToolItems();
    render();
}

// ==============================================
// OBJETO GLOBAL CASE COLLAB
// ==============================================
window.CaseCollab = {
    init: function(sessionToken, proyectoId, jwtToken) {
        if (stompClient) {
            try {
                stompClient.deactivate();
            } catch(e) {
                console.warn('Error desactivando cliente STOMP previo:', e);
            }
            stompClient = null;
        }

        currentSessionToken = sessionToken;
        currentProyectoId = proyectoId;
        diagramData = { clases: [], relaciones: [] };
        selectedClases = [];
        selectedClase = null;
        selectedRelacion = null;
        
        try {
            const rawUid = localStorage.getItem('usuario_id') || window.usuarioAutenticadoId;
            if (rawUid && !isNaN(rawUid)) {
                myUserId = Number(rawUid);
            } else if (jwtToken && jwtToken.includes('.')) {
                const payload = JSON.parse(atob(jwtToken.split('.')[1]));
                myUserId = Number(payload.usuarioId || payload.id || 1);
            } else {
                myUserId = 1;
            }
        } catch(e) {
            myUserId = 1;
        }

        resizeCanvas();
        initToolbox();

        const btnSaveCloud = document.getElementById('btn-save-cloud');
        if (btnSaveCloud && !btnSaveCloud.hasAttribute('data-bound')) {
            btnSaveCloud.setAttribute('data-bound', 'true');
            btnSaveCloud.addEventListener('click', () => {
                window.CaseCollab.guardarAvance(true);
            });
        }

        const wsEndpoint = (window.location && window.location.origin) ? (window.location.origin + '/ws-case') : '/ws-case';
        const socket = new SockJS(wsEndpoint);
        stompClient = new window.StompJs.Client({
            webSocketFactory: () => socket,
            connectHeaders: { Authorization: `Bearer ${jwtToken}` },
            debug: (str) => console.log('[STOMP]', str),
            onConnect: (frame) => onConnected(sessionToken),
            onStompError: (frame) => console.error('[STOMP Error]', frame)
        });

        window.stompClient = stompClient;
        stompClient.activate();
        window.CaseCollab.recargarDiagrama(proyectoId);
    },

    disconnect: function() {
        if (stompClient) {
            try {
                stompClient.deactivate();
            } catch(e) {}
            stompClient = null;
            window.stompClient = null;
        }
        diagramData = { clases: [], relaciones: [] };
        selectedClases = [];
        selectedClase = null;
        selectedRelacion = null;
    },

    crearClase: function(nombre, attrName, attrType, estereotipo = 'CLASS') {
        const attrs = attrName ? [{ nombre: attrName, tipoDato: attrType || 'String' }] : [];
        return window.CaseCollab.crearClaseConAtributos(nombre, attrs, estereotipo);
    },

    crearClaseConAtributos: function(nombre, atributosList = [], estereotipo = 'CLASS', posX = null, posY = null) {
        if (!nombre || !nombre.trim()) return null;
        nombre = nombre.trim();
        nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);

        const tempId = 'temp-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const index = diagramData.clases.length;
        const col = index % 4;
        const row = Math.floor(index / 4);
        
        const finalPosX = posX !== null ? posX : (80 + col * 240);
        const finalPosY = posY !== null ? posY : (80 + row * 180);

        const formattedAttrs = (atributosList || []).map((a, i) => ({
            id: 'temp-attr-' + (Date.now() + i),
            nombre: a.nombre || 'attr',
            tipoDato: a.tipoDato || a.tipo || 'String',
            tipo: a.tipoDato || a.tipo || 'String',
            visibilidad: a.visibilidad || 'private',
            esPk: Boolean(a.esPk),
            orden: i
        }));

        const nuevaClase = {
            id: tempId,
            tempId: tempId,
            nombre: nombre,
            estereotipo: estereotipo,
            posX: finalPosX,
            posY: finalPosY,
            bloqueadoPorId: null,
            atributos: formattedAttrs
        };

        if (stompClient && stompClient.connected) {
            stompClient.publish({
                destination: `/app/sala/${currentSessionToken}/clase/agregar`,
                body: JSON.stringify({
                    tempId: tempId,
                    nombre: nombre,
                    estereotipo: estereotipo,
                    posX: nuevaClase.posX,
                    posY: nuevaClase.posY,
                    atributos: formattedAttrs.map(a => ({ nombre: a.nombre, tipo: a.tipoDato, visibilidad: a.visibilidad, esPk: a.esPk }))
                })
            });
        }

        diagramData.clases.push(nuevaClase);
        selectedClases = [nuevaClase];
        selectedClase = nuevaClase;
        updateQuickActionsPosition();
        render();

        return nuevaClase;
    },

    agregarAtributoAClase: function(nombreClase, nombreAttr, tipoAttr = 'String', vis = 'private', esPk = false) {
        if (!nombreClase || !nombreAttr) return false;
        const target = diagramData.clases.find(c => c.nombre.toLowerCase() === nombreClase.trim().toLowerCase());
        if (target) {
            agregarAtributo(target, vis, nombreAttr.trim(), tipoAttr, esPk);
            window.CaseCollab.guardarAvance(false);
            return true;
        }
        return false;
    },

    eliminarAtributoDeClase: function(nombreClase, nombreAttr) {
        if (!nombreClase || !nombreAttr) return false;
        const target = diagramData.clases.find(c => c.nombre.toLowerCase() === nombreClase.trim().toLowerCase());
        if (target && target.atributos) {
            const attr = target.atributos.find(a => a.nombre.toLowerCase() === nombreAttr.trim().toLowerCase());
            if (attr) {
                eliminarAtributo(target, attr);
                window.CaseCollab.guardarAvance(false);
                return true;
            }
        }
        return false;
    },

    crearRelacionEntreClases: function(nombreOrigen, nombreDestino, tipo = 'ASOCIACION', cardOrig = '1', cardDest = '1', nombreRel = '') {
        if (!nombreOrigen || !nombreDestino) return false;
        const cOrig = diagramData.clases.find(c => c.nombre.toLowerCase() === nombreOrigen.trim().toLowerCase());
        const cDest = diagramData.clases.find(c => c.nombre.toLowerCase() === nombreDestino.trim().toLowerCase());
        if (cOrig && cDest && cOrig.id !== cDest.id) {
            crearRelacionDirecta(cOrig, cDest, tipo, cardOrig, cardDest, nombreRel);
            window.CaseCollab.guardarAvance(false);
            return true;
        }
        return false;
    },

    eliminarRelacionEntreClases: function(nombreOrigen, nombreDestino) {
        if (!nombreOrigen || !nombreDestino) return false;
        const origNorm = nombreOrigen.trim().toLowerCase();
        const destNorm = nombreDestino.trim().toLowerCase();

        const relsToDelete = diagramData.relaciones.filter(r => {
            const orig = diagramData.clases.find(c => String(c.id) === String(r.claseOrigen ? r.claseOrigen.id : r.origenId));
            const dest = diagramData.clases.find(c => String(c.id) === String(r.claseDestino ? r.claseDestino.id : r.destinoId));
            if (!orig || !dest) return false;
            const oName = orig.nombre.toLowerCase();
            const dName = dest.nombre.toLowerCase();
            return (oName === origNorm && dName === destNorm) || (oName === destNorm && dName === origNorm);
        });

        if (relsToDelete.length === 0) return false;

        relsToDelete.forEach(rel => {
            diagramData.relaciones = diagramData.relaciones.filter(r => r !== rel && r.id !== rel.id);
            if (stompClient && stompClient.connected && rel.id && !String(rel.id).startsWith('temp-rel-')) {
                stompClient.publish({
                    destination: `/app/sala/${currentSessionToken}/relacion/eliminar`,
                    body: JSON.stringify({ relacionId: rel.id })
                });
            }
        });

        selectedRelacion = null;
        closeRelationInspector();
        updateQuickRelActionsPosition();
        render();
        window.CaseCollab.guardarAvance(false);
        return true;
    },

    eliminarClasePorNombre: function(nombreClase, promptConfirm = false) {
        if (!nombreClase) return false;
        const c = diagramData.clases.find(cl => cl.nombre.toLowerCase() === nombreClase.trim().toLowerCase());
        if (!c) return false;

        if (promptConfirm && !confirm(`¿Estás seguro de eliminar la clase "${c.nombre}" y sus relaciones?`)) {
            return false;
        }

        diagramData.clases = diagramData.clases.filter(item => item.id !== c.id);
        diagramData.relaciones = diagramData.relaciones.filter(r => 
            (r.claseOrigen ? r.claseOrigen.id : r.origenId) !== c.id &&
            (r.claseDestino ? r.claseDestino.id : r.destinoId) !== c.id
        );

        if (stompClient && stompClient.connected && !String(c.id).startsWith('temp-')) {
            stompClient.publish({
                destination: `/app/sala/${currentSessionToken}/clase/eliminar`,
                body: JSON.stringify({ claseId: c.id })
            });
        }

        selectedClases = selectedClases.filter(item => item.id !== c.id);
        if (selectedClase && selectedClase.id === c.id) {
            selectedClase = null;
            closeClassInspector();
            updateQuickActionsPosition();
        }
        render();
        window.CaseCollab.guardarAvance(false);
        return true;
    },

    seleccionarTodas: function() {
        selectedClases = [...diagramData.clases];
        selectedClase = selectedClases.length > 0 ? selectedClases[0] : null;
        selectedRelacion = null;
        updateQuickActionsPosition();
        render();
    },

    deseleccionarTodas: function() {
        selectedClases = [];
        selectedClase = null;
        selectedRelacion = null;
        updateQuickActionsPosition();
        render();
    },

    getDiagramData: function() {
        return diagramData;
    },

    recargarDiagrama: async function(proyectoId) {
        if (!currentSessionToken) return;
        try {
            const rawToken = localStorage.getItem('jwt_token') || window.jwtToken;
            if (!rawToken) return;
            const res = await fetch(`/api/v1/sesiones/${currentSessionToken}/unirse`, {
                method: 'POST',
                headers: {
                    'Authorization': rawToken.startsWith('Bearer') ? rawToken : `Bearer ${rawToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (res.ok) {
                const snapshot = await res.json();
                diagramData.clases = snapshot.clases || [];
                diagramData.relaciones = snapshot.relaciones || [];
                selectedClases = [];
                selectedClase = null;
                selectedRelacion = null;
                render();
            }
        } catch (e) {
            console.error("Error recargando diagrama:", e);
        }
    },

    cargarSnapshot: function(snapshot) {
        if (!snapshot) return;
        diagramData.clases = snapshot.clases || [];
        diagramData.relaciones = snapshot.relaciones || [];
        if (snapshot.zoomCanvas != null) zoomCanvas = snapshot.zoomCanvas;
        if (snapshot.panX != null) panX = snapshot.panX;
        if (snapshot.panY != null) panY = snapshot.panY;
        selectedClases = [];
        selectedClase = null;
        selectedRelacion = null;
        updateWorkspaceGridPosition();
        render();
    },

    guardarAvance: async function(showToast = true) {
        if (!currentSessionToken) return;
        try {
            const rawToken = localStorage.getItem('jwt_token') || window.jwtToken;
            if (!rawToken) return;
            
            const payload = {
                clases: diagramData.clases.map(c => ({
                    id: (String(c.id).startsWith('temp-') ? null : c.id),
                    clientId: String(c.id),
                    nombre: c.nombre,
                    estereotipo: c.estereotipo || 'CLASS',
                    visibilidad: c.visibilidad || 'public',
                    posX: c.posX,
                    posY: c.posY,
                    atributos: (c.atributos || []).map(a => ({
                        id: (String(a.id).startsWith('temp-') ? null : a.id),
                        nombre: a.nombre,
                        tipoDato: a.tipoDato || a.tipo || 'String',
                        visibilidad: a.visibilidad || 'private',
                        esPk: !!a.esPk
                    })),
                    metodos: (c.metodos || []).map(m => ({
                        id: (String(m.id).startsWith('temp-') ? null : m.id),
                        nombre: m.nombre,
                        tipoRetorno: m.tipoRetorno || m.tipo || 'void',
                        visibilidad: m.visibilidad || 'public',
                        orden: m.orden || 0
                    }))
                })),
                relaciones: diagramData.relaciones.map(r => ({
                    id: (String(r.id).startsWith('temp-') ? null : r.id),
                    origenId: getRelOrigId(r),
                    destinoId: getRelDestId(r),
                    tipoRelacion: r.tipoRelacion || r.tipo || 'ASOCIACION',
                    nombre: r.nombre || '',
                    cardinalidadOrigen: r.cardinalidadOrigen || '1',
                    cardinalidadDestino: r.cardinalidadDestino || '1'
                }))
            };

            const res = await fetch(`/api/v1/sesiones/${currentSessionToken}/guardar`, {
                method: 'POST',
                headers: {
                    'Authorization': rawToken.startsWith('Bearer') ? rawToken : `Bearer ${rawToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const snapshot = await res.json();
                diagramData.clases = snapshot.clases || [];
                diagramData.relaciones = snapshot.relaciones || [];
                if (selectedClase) {
                    selectedClase = diagramData.clases.find(c => String(c.id) === String(selectedClase.id)) || selectedClase;
                }
                render();
                if (showToast) {
                    mostrarNotificacion('¡Avance guardado con éxito!');
                }
            }
        } catch(e) {
            console.error("Error guardando avance:", e);
        }
    },

    clearSelection: function() {
        selectedClases = [];
        selectedClase = null;
        selectedRelacion = null;
        relationSourceClass = null;
        clearActiveToolItems();
        updateQuickActionsPosition();
        updateQuickRelActionsPosition();
        render();
    }
};

const USER_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#06B6D4', '#F97316', '#14B8A6'
];

function getUserColor(userId) {
    const num = Number(userId) || 0;
    return USER_COLORS[Math.abs(num) % USER_COLORS.length];
}

const activeCollaborators = new Map();

function registrarColaboradorActivo(id, nombre, rol = 'COLABORADOR') {
    if (!id) return;
    const color = getUserColor(id);
    activeCollaborators.set(String(id), {
        id: String(id),
        nombre: nombre || `Usuario #${id}`,
        rol: rol || 'COLABORADOR',
        color: color,
        lastActive: Date.now()
    });
    renderColaboradoresHeader();
}

function renderColaboradoresHeader() {
    const container = document.getElementById('colaboradores-container');
    if (!container) return;
    container.style.display = 'flex';
    container.innerHTML = '';

    const myId = String(myUserId || 'yo');
    const myName = localStorage.getItem('usuario_nombre') || 'Yo';
    const myRole = localStorage.getItem('usuario_rol') || 'ANFITRION';
    const myColor = getUserColor(myId);

    const selfBadge = document.createElement('div');
    selfBadge.className = 'collab-avatar-badge';
    selfBadge.title = `${myName} (${myRole}) - Tú`;
    selfBadge.innerHTML = `
        <div class="collab-avatar-circle" style="background: ${myColor};">
            ${myName.substring(0, 2).toUpperCase()}
        </div>
        <span>${myName}</span>
        <span class="tag ${myRole === 'ANFITRION' ? 'tag-green' : 'tag-blue'}" style="font-size: 9px; padding: 1px 5px;">${myRole}</span>
        <div class="collab-online-dot"></div>
    `;
    container.appendChild(selfBadge);

    activeCollaborators.forEach((collab, cId) => {
        if (cId === myId) return;
        const badge = document.createElement('div');
        badge.className = 'collab-avatar-badge';
        badge.title = `${collab.nombre} (${collab.rol}) - En línea`;
        badge.innerHTML = `
            <div class="collab-avatar-circle" style="background: ${collab.color};">
                ${(collab.nombre || 'U').substring(0, 2).toUpperCase()}
            </div>
            <span>${collab.nombre}</span>
            <span class="tag ${collab.rol === 'ANFITRION' ? 'tag-green' : 'tag-blue'}" style="font-size: 9px; padding: 1px 5px;">${collab.rol}</span>
            <div class="collab-online-dot"></div>
        `;
        container.appendChild(badge);
    });
}

function onConnected(sessionToken) {
    console.log('STOMP Conectado a sala:', sessionToken);
    
    stompClient.subscribe(`/topic/sala/${sessionToken}`, (message) => {
        try {
            const payload = JSON.parse(message.body);
            handleSocketEvent(payload);
        } catch (e) {
            console.error('Error parseando evento socket:', e);
        }
    });

    stompClient.subscribe('/user/queue/reply', (message) => {
        try {
            const payload = JSON.parse(message.body);
            handleSocketEvent(payload);
        } catch (e) {
            console.error('Error parseando respuesta socket:', e);
        }
    });

    const myName = localStorage.getItem('usuario_nombre') || 'Usuario';
    const myRole = localStorage.getItem('usuario_rol') || 'COLABORADOR';
    stompClient.publish({
        destination: `/app/sala/${sessionToken}/presencia/unirse`,
        body: JSON.stringify({ usuarioId: myUserId, nombre: myName, rol: myRole })
    });

    renderColaboradoresHeader();
    window.CaseCollab.recargarDiagrama(currentProyectoId);
}

function handleSocketEvent(envelope) {
    const { eventType, data } = envelope;

    const isSelf = (envelope.senderId === myUserId);

    if (isSelf && eventType !== 'LOCK_GRANTED' && eventType !== 'LOCK_DENIED' && eventType !== 'CLASS_CREATED' && eventType !== 'RELATION_MUTATED' && eventType !== 'ATTRIBUTE_MUTATED' && eventType !== 'CLASS_MUTATED') {
        return; 
    }

    switch (eventType) {
        case 'USER_JOINED':
            if (!isSelf) {
                const uId = envelope.senderId || (data && data.usuarioId);
                const uName = envelope.senderName || (data && data.nombre) || 'Colaborador';
                const uRole = (data && data.rol) || 'COLABORADOR';
                registrarColaboradorActivo(uId, uName, uRole);
                mostrarNotificacion(`✨ ${uName} se ha unido a la sala`);
            }
            break;
        case 'CURSOR_MOVED':
            updateRemoteCursor(envelope.senderId, envelope.senderName, data.x, data.y);
            break;
        case 'CLASS_MOVED':
            const clase = diagramData.clases.find(c => String(c.id) === String(data.claseId));
            if (clase) {
                if (data.posX !== undefined) clase.posX = data.posX;
                if (data.posY !== undefined) clase.posY = data.posY;
                if (data.nombre !== undefined) clase.nombre = data.nombre;
                render();
                updateQuickActionsPosition();
            }
            break;
        case 'CLASS_CREATED':
            let existing = null;
            if (data.tempId) {
                existing = diagramData.clases.find(c => String(c.id) === String(data.tempId) || c.tempId === data.tempId);
            }
            if (!existing) {
                existing = diagramData.clases.find(c => String(c.id) === String(data.id) || (String(c.id).startsWith('temp-') && c.nombre === data.nombre));
            }
            if (existing) {
                const oldId = existing.id;
                existing.id = data.id;
                if (data.nombre) existing.nombre = data.nombre;
                if (data.estereotipo) existing.estereotipo = data.estereotipo;
                if (data.posX !== undefined) existing.posX = data.posX;
                if (data.posY !== undefined) existing.posY = data.posY;
                if (data.atributos) existing.atributos = data.atributos;

                // Actualizar relaciones que referenciaban el ID temporal
                diagramData.relaciones.forEach(r => {
                    if (r.claseOrigen && String(r.claseOrigen.id) === String(oldId)) r.claseOrigen.id = data.id;
                    if (r.claseDestino && String(r.claseDestino.id) === String(oldId)) r.claseDestino.id = data.id;
                    if (String(r.origenId) === String(oldId)) r.origenId = data.id;
                    if (String(r.destinoId) === String(oldId)) r.destinoId = data.id;
                });
            } else {
                diagramData.clases.push({ 
                    id: data.id, 
                    nombre: data.nombre, 
                    estereotipo: data.estereotipo || 'CLASS',
                    posX: data.posX || 150, 
                    posY: data.posY || 150, 
                    bloqueadoPorId: null,
                    atributos: data.atributos || []
                });
            }
            render();
            break;
        case 'CLASS_DELETED':
            diagramData.clases = diagramData.clases.filter(c => String(c.id) !== String(data.claseId));
            diagramData.relaciones = diagramData.relaciones.filter(r => 
                String(r.claseOrigen ? r.claseOrigen.id : r.origenId) !== String(data.claseId) &&
                String(r.claseDestino ? r.claseDestino.id : r.destinoId) !== String(data.claseId)
            );
            selectedClases = selectedClases.filter(c => String(c.id) !== String(data.claseId));
            if (selectedClase && String(selectedClase.id) === String(data.claseId)) {
                selectedClase = null;
                updateQuickActionsPosition();
            }
            render();
            break;
        case 'ATTRIBUTE_MUTATED':
            const targetClase = diagramData.clases.find(c => String(c.id) === String(data.claseId));
            if (targetClase) {
                if (!targetClase.atributos) targetClase.atributos = [];
                if (data.action === 'DELETE') {
                    targetClase.atributos = targetClase.atributos.filter(a => String(a.id) !== String(data.atributoId));
                } else if (data.action === 'UPDATE') {
                    const attr = targetClase.atributos.find(a => String(a.id) === String(data.atributoId));
                    if (attr) {
                        if (data.nombre) attr.nombre = data.nombre;
                        if (data.tipoDato) attr.tipoDato = data.tipoDato;
                        if (data.visibilidad) attr.visibilidad = data.visibilidad;
                        if (data.esPk !== undefined) attr.esPk = data.esPk;
                    }
                } else {
                    // CREATE
                    let existingAttr = targetClase.atributos.find(a => String(a.id) === String(data.atributoId));
                    if (!existingAttr && data.nombre) {
                        existingAttr = targetClase.atributos.find(a => String(a.id).startsWith('temp-attr-') && a.nombre === data.nombre);
                    }
                    if (!existingAttr) {
                        existingAttr = targetClase.atributos.find(a => String(a.id).startsWith('temp-attr-'));
                    }

                    if (existingAttr) {
                        existingAttr.id = data.atributoId;
                        if (data.nombre) existingAttr.nombre = data.nombre;
                        if (data.tipoDato) existingAttr.tipoDato = data.tipoDato;
                        if (data.visibilidad) existingAttr.visibilidad = data.visibilidad;
                        if (data.esPk !== undefined) existingAttr.esPk = data.esPk;
                    } else {
                        const alreadyPresent = targetClase.atributos.some(a => String(a.id) === String(data.atributoId) || (a.nombre === data.nombre && a.tipoDato === data.tipoDato));
                        if (!alreadyPresent) {
                            targetClase.atributos.push({
                                id: data.atributoId,
                                nombre: data.nombre,
                                tipoDato: data.tipoDato,
                                visibilidad: data.visibilidad,
                                esPk: data.esPk
                            });
                        }
                    }
                }
                if (selectedClase && String(selectedClase.id) === String(targetClase.id)) {
                    renderInspectorAttributes(targetClase);
                }
                render();
            }
            break;
        case 'RELATION_MUTATED':
            if (data.action === 'DELETE') {
                diagramData.relaciones = diagramData.relaciones.filter(r => String(r.id) !== String(data.relacionId));
            } else if (data.action === 'UPDATE') {
                const targetRel = diagramData.relaciones.find(r => String(r.id) === String(data.relacionId));
                if (targetRel) {
                    if (data.nombre !== undefined) targetRel.nombre = data.nombre;
                    if (data.tipoRelacion !== undefined) targetRel.tipoRelacion = data.tipoRelacion;
                    if (data.cardinalidadOrigen !== undefined) targetRel.cardinalidadOrigen = data.cardinalidadOrigen;
                    if (data.cardinalidadDestino !== undefined) targetRel.cardinalidadDestino = data.cardinalidadDestino;
                }
            } else {
                let eRel = null;
                if (data.tempId) {
                    eRel = diagramData.relaciones.find(r => String(r.id) === String(data.tempId) || r.tempId === data.tempId);
                }
                if (!eRel) {
                    eRel = diagramData.relaciones.find(r => String(r.id) === String(data.id) || String(r.id).startsWith('temp-rel-'));
                }
                if (eRel) {
                    eRel.id = data.id;
                    if (data.tipo) eRel.tipoRelacion = data.tipo;
                } else {
                    diagramData.relaciones.push(data);
                }
            }
            render();
            break;
        case 'LOCK_GRANTED':
            if (data.lockedByUserId === myUserId) {
                const target = diagramData.clases.find(c => String(c.id) === String(data.elementId));
                if (target) target.lockedByUserId = myUserId;
            }
            break;
        case 'LOCK_DENIED':
            alert(`No puedes editar: bloqueado por ${data.lockedByUserName}`);
            isDragging = false;
            break;
        case 'LOCK_RELEASED':
            const targetRel = diagramData.clases.find(c => String(c.id) === String(data.elementId));
            if (targetRel) {
                targetRel.lockedByUserId = null;
                targetRel.lockedByUserName = null;
                render();
            }
            break;
    }
}

function updateRemoteCursor(id, nombre, x, y) {
    if (!cursoresContainer) return;
    if (String(id) === String(myUserId)) return;

    let cursor = document.getElementById(`cursor-${id}`);
    const color = getUserColor(id);

    if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = `cursor-${id}`;
        cursor.className = 'cursor-remoto';
        cursor.innerHTML = `
            <svg viewBox="0 0 24 24" style="fill: ${color};">
                <path d="M3 3l7 18 3-7 7-3L3 3z"/>
            </svg>
            <div class="cursor-label" style="background: ${color};">
                <span>${nombre || 'Colaborador'}</span>
            </div>
        `;
        cursoresContainer.appendChild(cursor);
    }

    const screenX = x * zoomCanvas + panX;
    const screenY = y * zoomCanvas + panY;

    cursor.style.left = `${screenX}px`;
    cursor.style.top = `${screenY}px`;

    registrarColaboradorActivo(id, nombre);
}

// ==============================================
// SHORTCUTS (CTRL+A SELECCIONAR TODO)
// ==============================================
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        // Only if not typing in an input
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        e.preventDefault();
        selectedClases = [...diagramData.clases];
        selectedClase = selectedClases.length > 0 ? selectedClases[0] : null;
        selectedRelacion = null;
        updateQuickActionsPosition();
        updateQuickRelActionsPosition();
        render();
    }
});

// ==============================================
// EVENTOS DEL CANVAS (SELECCIÓN, DRAG & DROP Y DOBLE CLICK)
// ==============================================
// Prevenir menú contextual del navegador para usar Clic Derecho en Pan
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

// Soporte de Rueda del Ratón: Zoom (Ctrl+Wheel) y Desplazamiento Pan (Wheel)
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.min(Math.max(0.3, zoomCanvas * zoomFactor), 3.0);
        
        const rect = canvas.getBoundingClientRect();
        const mouseCanvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const mouseCanvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
        
        panX = mouseCanvasX - (mouseCanvasX - panX) * (newZoom / zoomCanvas);
        panY = mouseCanvasY - (mouseCanvasY - panY) * (newZoom / zoomCanvas);
        zoomCanvas = newZoom;
    } else {
        panX -= e.deltaX;
        panY -= e.deltaY;
    }
    updateWorkspaceGridPosition();
    updateQuickActionsPosition();
    updateQuickRelActionsPosition();
    render();
}, { passive: false });

// Atajo de Teclado: Supr (Delete) y Backspace para eliminar selección activa
window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable)) {
        return;
    }
    const anyModalOpen = document.querySelector('.modal-overlay:not(.hidden)');
    if (anyModalOpen) {
        return;
    }

    if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
        if (selectedClases && selectedClases.length > 0) {
            e.preventDefault();
            const cantidad = selectedClases.length;
            const mensaje = cantidad === 1 
                ? `¿Eliminar la clase "${selectedClases[0].nombre}" y sus relaciones?`
                : `¿Eliminar las ${cantidad} clases seleccionadas y sus relaciones?`;
            
            if (confirm(mensaje)) {
                const clasesAEliminar = [...selectedClases];
                clasesAEliminar.forEach(c => {
                    diagramData.clases = diagramData.clases.filter(item => item.id !== c.id);
                    diagramData.relaciones = diagramData.relaciones.filter(r => 
                        (r.claseOrigen ? r.claseOrigen.id : r.origenId) !== c.id &&
                        (r.claseDestino ? r.claseDestino.id : r.destinoId) !== c.id
                    );
                    if (stompClient && stompClient.connected && !String(c.id).startsWith('temp-')) {
                        stompClient.publish({
                            destination: `/app/sala/${currentSessionToken}/clase/eliminar`,
                            body: JSON.stringify({ claseId: c.id })
                        });
                    }
                });
                selectedClases = [];
                selectedClase = null;
                closeClassInspector();
                updateQuickActionsPosition();
                render();
                if (window.CaseCollab) window.CaseCollab.guardarAvance(false);
            }
        } else if (selectedRelacion) {
            e.preventDefault();
            if (confirm('¿Eliminar la relación seleccionada?')) {
                const rel = selectedRelacion;
                diagramData.relaciones = diagramData.relaciones.filter(r => r !== rel && r.id !== rel.id);
                if (stompClient && stompClient.connected && rel.id && !String(rel.id).startsWith('temp-rel-')) {
                    stompClient.publish({
                        destination: `/app/sala/${currentSessionToken}/relacion/eliminar`,
                        body: JSON.stringify({ relacionId: rel.id })
                    });
                }
                selectedRelacion = null;
                closeRelationInspector();
                updateQuickRelActionsPosition();
                render();
                if (window.CaseCollab) window.CaseCollab.guardarAvance(false);
            }
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    // Si estamos en modo Pan (desplazamiento con clic derecho)
    if (isPanning) {
        panX = e.clientX - panStartX;
        panY = e.clientY - panStartY;
        canvas.style.cursor = 'grabbing';
        updateWorkspaceGridPosition();
        updateQuickActionsPosition();
        updateQuickRelActionsPosition();
        render();
        return;
    }

    const coords = getCanvasCoords(e);
    const { x, y } = coords;

    if (stompClient && stompClient.connected) {
        const now = Date.now();
        if (now - lastMouseUpdate > 60) { 
            const uid = Number(myUserId) || 1;
            stompClient.publish({
                destination: `/app/sala/${currentSessionToken}/presencia/cursor`,
                body: JSON.stringify({ usuarioId: uid, nombreUsuario: "Yo", x, y })
            });
            lastMouseUpdate = now;
        }
    }

    if (isDragging) {
        const deltaX = x - dragStartX;
        const deltaY = y - dragStartY;

        selectedClases.forEach(c => {
            const initial = dragOriginPositions.get(c.id);
            if (initial) {
                c.posX = Math.max(10, initial.x + deltaX);
                c.posY = Math.max(10, initial.y + deltaY);

                if (stompClient && stompClient.connected) {
                    stompClient.publish({
                        destination: `/app/sala/${currentSessionToken}/clase/mover`,
                        body: JSON.stringify({ claseId: c.id, posX: c.posX, posY: c.posY, version: 1, clientTimestamp: Date.now() })
                    });
                }
            }
        });

        canvas.style.cursor = 'grabbing';
        updateQuickActionsPosition();
        render();
    } else if (isMarqueeSelecting) {
        marqueeEnd = { x, y };
        
        const minX = Math.min(marqueeStart.x, marqueeEnd.x);
        const maxX = Math.max(marqueeStart.x, marqueeEnd.x);
        const minY = Math.min(marqueeStart.y, marqueeEnd.y);
        const maxY = Math.max(marqueeStart.y, marqueeEnd.y);

        selectedClases = diagramData.clases.filter(c => {
            const dim = getClassDimensions(c);
            return (c.posX + dim.width >= minX && c.posX <= maxX &&
                    c.posY + dim.height >= minY && c.posY <= maxY);
        });
        selectedClase = selectedClases.length > 0 ? selectedClases[0] : null;

        render();
    } else {
        const hoveredClass = findClassAt(x, y);
        const hoveredRel = findRelationAt(x, y);

        if (canvasMode === MODE_POINTER) {
            canvas.style.cursor = hoveredClass ? 'grab' : (hoveredRel ? 'pointer' : 'default');
        } else if (canvasMode === MODE_RELATION) {
            canvas.style.cursor = hoveredClass ? 'crosshair' : 'default';
        }
    }
});

canvas.addEventListener('mousedown', (e) => {
    // Clic Derecho (botón 2), botón rueda central (botón 1) o Alt+Clic: Iniciar Pan / Desplazamiento
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning = true;
        panStartX = e.clientX - panX;
        panStartY = e.clientY - panY;
        canvas.style.cursor = 'grab';
        return;
    }

    const coords = getCanvasCoords(e);
    const { x, y } = coords;
    const targetClass = findClassAt(x, y);
    const targetRel = findRelationAt(x, y);
    const now = Date.now();

    // Detección de Doble Clic
    if (targetClass && (now - lastClickTime < 350)) {
        openClassInspector(targetClass);
        lastClickTime = 0;
        return;
    }
    if (targetRel && (now - lastClickTime < 350)) {
        openRelationInspector(targetRel.relacion);
        lastClickTime = 0;
        return;
    }
    lastClickTime = now;

    if (canvasMode === MODE_POINTER) {
        if (targetClass) {
            selectedRelacion = null;
            updateQuickRelActionsPosition();

            if (e.shiftKey || e.ctrlKey) {
                if (selectedClases.some(c => c.id === targetClass.id)) {
                    selectedClases = selectedClases.filter(c => c.id !== targetClass.id);
                    selectedClase = selectedClases.length > 0 ? selectedClases[0] : null;
                } else {
                    selectedClases.push(targetClass);
                    selectedClase = targetClass;
                }
            } else {
                if (!selectedClases.some(c => c.id === targetClass.id)) {
                    selectedClases = [targetClass];
                    selectedClase = targetClass;
                }
            }

            isDragging = true;
            dragStartX = x;
            dragStartY = y;
            dragOriginPositions.clear();
            selectedClases.forEach(c => {
                dragOriginPositions.set(c.id, { x: c.posX, y: c.posY });
            });

            canvas.style.cursor = 'grabbing';
            updateQuickActionsPosition();

            if (stompClient && stompClient.connected) {
                selectedClases.forEach(c => {
                    stompClient.publish({
                        destination: `/app/sala/${currentSessionToken}/lock/solicitar`,
                        body: JSON.stringify({ elementId: c.id, elementType: 'CLASE' })
                    });
                });
            }
        } else if (targetRel) {
            // Seleccionar relación (línea)
            selectedRelacion = targetRel.relacion;
            selectedClases = [];
            selectedClase = null;
            updateQuickActionsPosition();
            updateQuickRelActionsPosition();
        } else {
            // Clic en lienzo vacío: iniciar Marquee box
            if (!e.shiftKey && !e.ctrlKey) {
                selectedClases = [];
                selectedClase = null;
                selectedRelacion = null;
                updateQuickActionsPosition();
                updateQuickRelActionsPosition();
            }

            isMarqueeSelecting = true;
            marqueeStart = { x, y };
            marqueeEnd = { x, y };
        }
        render();
    } else if (canvasMode === MODE_RELATION) {
        if (targetClass) {
            if (!relationSourceClass) {
                relationSourceClass = targetClass;
                render();
            } else {
                if (relationSourceClass.id !== targetClass.id) {
                    crearRelacionDirecta(relationSourceClass, targetClass, selectedRelationType);
                }
            }
        } else {
            relationSourceClass = null;
            canvasMode = MODE_POINTER;
            clearActiveToolItems();
            render();
        }
    }
});

window.addEventListener('mouseup', () => {
    if (isPanning) {
        isPanning = false;
        canvas.style.cursor = 'default';
        render();
    }

    if (isDragging) {
        if (stompClient && stompClient.connected) {
            selectedClases.forEach(c => {
                if (!String(c.id).startsWith('temp-')) {
                    stompClient.publish({
                        destination: `/app/sala/${currentSessionToken}/lock/liberar`,
                        body: JSON.stringify({ elementId: c.id, elementType: 'CLASE' })
                    });
                }
            });
        }
        isDragging = false;
        canvas.style.cursor = 'default';
        updateQuickActionsPosition();
        render();

        // Auto-guardado de posiciones finales en PostgreSQL
        if (window.CaseCollab) {
            window.CaseCollab.guardarAvance(false);
        }
    }

    if (isMarqueeSelecting) {
        isMarqueeSelecting = false;
        updateQuickActionsPosition();
        render();
    }
});

// ==============================================
// RENDERIZADO DEL DIAGRAMA UML (CON TRANSFORMACIÓN PAN & ZOOM)
// ==============================================

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoomCanvas, zoomCanvas);

    // 1. Dibujar Relaciones UML
    diagramData.relaciones.forEach(r => {
        const origId = getRelOrigId(r);
        const destId = getRelDestId(r);
        const origen = diagramData.clases.find(c => String(c.id) === origId);
        const destino = diagramData.clases.find(c => String(c.id) === destId);
        if (origen && destino) {
            const isSelected = (selectedRelacion && String(selectedRelacion.id) === String(r.id));
            dibujarLineaRelacion(origen, destino, r.tipoRelacion || r.tipo, r.nombre, r.cardinalidadOrigen, r.cardinalidadDestino, isSelected);
        }
    });

    // 2. Dibujar Clases UML
    diagramData.clases.forEach(c => {
        const dim = getClassDimensions(c);
        const isSelected = selectedClases.some(sel => String(sel.id) === String(c.id));
        const isRelationSource = (canvasMode === MODE_RELATION && relationSourceClass && String(relationSourceClass.id) === String(c.id));
        const isLocked = (c.lockedByUserId != null && c.lockedByUserId !== myUserId);

        // Fondo de la caja de clase
        ctx.fillStyle = colorFondo;
        ctx.shadowColor = isSelected ? "rgba(59, 130, 246, 0.6)" : "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = isSelected ? 16 : 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 3;
        ctx.fillRect(c.posX, c.posY, dim.width, dim.height);

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // Borde exterior
        ctx.setLineDash([]);
        if (isLocked) {
            ctx.strokeStyle = colorBordeBloqueado;
            ctx.lineWidth = 2;
        } else if (isRelationSource) {
            ctx.strokeStyle = colorBordeRelacion;
            ctx.lineWidth = 2.5;
        } else if (isSelected) {
            ctx.strokeStyle = colorBordeSeleccionado;
            ctx.lineWidth = 2;
        } else {
            ctx.strokeStyle = colorBordeNormal;
            ctx.lineWidth = 1;
        }
        ctx.strokeRect(c.posX, c.posY, dim.width, dim.height);

        // Cabecera de la Clase
        ctx.fillStyle = colorHeader;
        ctx.fillRect(c.posX + 1, c.posY + 1, dim.width - 2, dim.headerHeight);

        // Texto Cabecera: Estereotipo y Nombre
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.fillStyle = colorTextoPrincipal;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (dim.hasStereotype) {
            ctx.font = "italic 10px Inter, sans-serif";
            ctx.fillStyle = "#A78BFA";
            ctx.fillText(`<<${c.estereotipo.toLowerCase()}>>`, c.posX + dim.width / 2, c.posY + 13);
            ctx.font = "bold 12px Inter, sans-serif";
            ctx.fillStyle = colorTextoPrincipal;
            ctx.fillText(c.nombre, c.posX + dim.width / 2, c.posY + 28);
        } else {
            ctx.fillText(c.nombre, c.posX + dim.width / 2, c.posY + dim.headerHeight / 2);
        }

        // Línea divisoria cabecera / atributos
        ctx.strokeStyle = colorBordeNormal;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c.posX, c.posY + dim.headerHeight);
        ctx.lineTo(c.posX + dim.width, c.posY + dim.headerHeight);
        ctx.stroke();

        // Atributos
        let attrY = c.posY + dim.headerHeight + 16;
        ctx.textAlign = "left";
        ctx.font = "11px Inter, sans-serif";

        if (c.atributos && c.atributos.length > 0) {
            c.atributos.forEach(attr => {
                const vis = attr.visibilidad === 'private' ? '-' : (attr.visibilidad === 'protected' ? '#' : (attr.visibilidad === 'package' ? '~' : '+'));
                const tipo = attr.tipoDato || attr.tipo || 'String';
                const pkBadge = attr.esPk ? ' {PK}' : '';
                ctx.fillStyle = attr.esPk ? "#60A5FA" : colorTextoSecundario;
                ctx.fillText(`${vis} ${attr.nombre}: ${tipo}${pkBadge}`, c.posX + 12, attrY);
                attrY += 20;
            });
        } else {
            ctx.fillStyle = "#6B7280";
            ctx.font = "italic 11px Inter, sans-serif";
            ctx.fillText("(sin atributos)", c.posX + 12, attrY);
        }

        // Línea divisoria atributos / operaciones (solo si hay métodos)
        if (dim.methods && dim.methods.length > 0) {
            const methodSepY = c.posY + dim.headerHeight + dim.attrHeight;
            ctx.strokeStyle = colorBordeNormal;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(c.posX, methodSepY);
            ctx.lineTo(c.posX + dim.width, methodSepY);
            ctx.stroke();

            // Métodos / Operaciones
            let methodY = methodSepY + 14;
            ctx.fillStyle = "#94A3B8";
            ctx.font = "11px Inter, sans-serif";
            ctx.textAlign = "left";
            dim.methods.forEach(m => {
                const vis = m.visibilidad === 'private' ? '-' : (m.visibilidad === 'protected' ? '#' : (m.visibilidad === 'package' ? '~' : '+'));
                const mName = (typeof m === 'string') ? m : `${vis} ${m.nombre}(): ${m.tipoRetorno || m.tipo || 'void'}`;
                ctx.fillText(mName, c.posX + 12, methodY);
                methodY += 18;
            });
        }

        // Indicador de Bloqueo remoto
        if (isLocked) {
            ctx.fillStyle = colorBordeBloqueado;
            ctx.font = "11px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("🔒 " + (c.lockedByUserName || 'Bloqueado'), c.posX + dim.width / 2, c.posY - 8);
        }
    });

    // 3. Dibujar Marquee Box si está activo
    if (isMarqueeSelecting) {
        const minX = Math.min(marqueeStart.x, marqueeEnd.x);
        const maxX = Math.max(marqueeStart.x, marqueeEnd.x);
        const minY = Math.min(marqueeStart.y, marqueeEnd.y);
        const maxY = Math.max(marqueeStart.y, marqueeEnd.y);
        const w = maxX - minX;
        const h = maxY - minY;

        ctx.fillStyle = "rgba(59, 130, 246, 0.15)";
        ctx.fillRect(minX, minY, w, h);

        ctx.strokeStyle = "#3B82F6";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(minX, minY, w, h);
        ctx.setLineDash([]);
    }

    ctx.restore();
}

function dibujarLineaRelacion(origen, destino, tipo, nombre, cardOrig, cardDest, isSelected) {
    const dimOrig = getClassDimensions(origen);
    const dimDest = getClassDimensions(destino);

    // Si es CLASE_ASOCIACION, nace desde el punto medio de la línea continua base
    if (tipo === "CLASE_ASOCIACION") {
        const baseRel = findBestBaseRelationForAssociation(origen, destino, nombre);

        let targetX = destino.posX + dimDest.width / 2;
        let targetY = destino.posY + dimDest.height / 2;

        if (baseRel) {
            const bOrigId = getRelOrigId(baseRel);
            const bDestId = getRelDestId(baseRel);
            const cA = diagramData.clases.find(c => String(c.id) === bOrigId);
            const cB = diagramData.clases.find(c => String(c.id) === bDestId);
            if (cA && cB) {
                const dimA = getClassDimensions(cA);
                const dimB = getClassDimensions(cB);
                targetX = ((cA.posX + dimA.width / 2) + (cB.posX + dimB.width / 2)) / 2;
                targetY = ((cA.posY + dimA.height / 2) + (cB.posY + dimB.height / 2)) / 2;
            }
        }

        const anchor = getBoxAnchorPoint(origen, targetX, targetY);
        const assocAnchorX = anchor.x;
        const assocAnchorY = anchor.y;

        ctx.strokeStyle = isSelected ? colorRelacionSeleccionada : "#94A3B8";
        ctx.lineWidth = isSelected ? 2.5 : 1.6;
        ctx.setLineDash([6, 4]);

        ctx.beginPath();
        ctx.moveTo(targetX, targetY);
        ctx.lineTo(assocAnchorX, assocAnchorY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isSelected) {
            const midX = (targetX + assocAnchorX) / 2;
            const midY = (targetY + assocAnchorY) / 2;
            ctx.fillStyle = colorRelacionSeleccionada;
            ctx.beginPath();
            ctx.arc(midX, midY, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    const x1 = origen.posX + dimOrig.width / 2;
    const y1 = origen.posY + dimOrig.height / 2;
    const x2 = destino.posX + dimDest.width / 2;
    const y2 = destino.posY + dimDest.height / 2;

    ctx.strokeStyle = isSelected ? colorRelacionSeleccionada : "#94A3B8";
    ctx.lineWidth = isSelected ? 3 : 1.8;
    
    if (tipo === "DEPENDENCIA" || tipo === "REALIZACION") {
        ctx.setLineDash([6, 4]);
    } else {
        ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Renderizar Nombre / Rol en el punto medio
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    if (nombre && nombre.trim()) {
        ctx.fillStyle = isSelected ? "#38BDF8" : "#E2E8F0";
        ctx.font = "italic 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(nombre, midX, midY - 6);
    }

    // Renderizar Cardinalidades (Visible para todos los valores no vacíos)
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillStyle = isSelected ? "#38BDF8" : "#E2E8F0";

    if (cardOrig && cardOrig.trim()) {
        const offsetOrigX = x1 + Math.cos(angle) * (dimOrig.width / 2 + 15) - Math.sin(angle) * 12;
        const offsetOrigY = y1 + Math.sin(angle) * (dimOrig.height / 2 + 15) + Math.cos(angle) * 12;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cardOrig.trim(), offsetOrigX, offsetOrigY);
    }

    if (cardDest && cardDest.trim()) {
        const offsetDestX = x2 - Math.cos(angle) * (dimDest.width / 2 + 15) - Math.sin(angle) * 12;
        const offsetDestY = y2 - Math.sin(angle) * (dimDest.height / 2 + 15) + Math.cos(angle) * 12;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cardDest.trim(), offsetDestX, offsetDestY);
    }

    // Dibujar Puntero / Manejador si está seleccionada
    if (isSelected) {
        ctx.fillStyle = colorRelacionSeleccionada;
        ctx.beginPath();
        ctx.arc(midX, midY, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Para Asociación Simple no se dibuja flecha terminal
    if (tipo === "ASOCIACION") {
        return;
    }

    // Dibujar Punta / Terminación UML 2.5
    const r = Math.min(dimDest.width, dimDest.height) / 2; 
    const arrowX = x2 - r * Math.cos(angle);
    const arrowY = y2 - r * Math.sin(angle);

    ctx.setLineDash([]);
    ctx.fillStyle = (tipo === "COMPOSICION") ? (isSelected ? colorRelacionSeleccionada : "#94A3B8") : colorFondo;

    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);

    if (tipo === "ASOCIACION_DIRIGIDA" || tipo === "DEPENDENCIA") {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-10, 5);
        ctx.moveTo(0, 0);
        ctx.lineTo(-10, -5);
        ctx.stroke();
    } else if (tipo === "AGREGACION" || tipo === "COMPOSICION") {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-10, 5);
        ctx.lineTo(-20, 0);
        ctx.lineTo(-10, -5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (tipo === "GENERALIZACION" || tipo === "REALIZACION") {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-12, 6);
        ctx.lineTo(-12, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}
